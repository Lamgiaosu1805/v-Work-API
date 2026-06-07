const { default: mongoose } = require("mongoose");
const AllowedWifiLocationModel = require("../models/AllowedWifiLocationModel");
const ShiftModel = require("../models/ShiftModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const HolidayModel = require("../models/HolidayModel");
const { RequestModel } = require("../models/RequestModel");
const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");
const { resolveLeaveConflictOnAttendance } = require("../helpers/leaveHandler");
const moment = require("moment-timezone");

const AttendanceController = {
  getAllowedWifiLocations: async (req, res) => {
    try {
      const docs = await AllowedWifiLocationModel.find({
        isDeleted: false,
      }).sort({ createdAt: -1 });
      res.json({
        message: "Lấy danh sách điểm chấm công thành công",
        data: docs,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Lỗi server.", error: error.message });
    }
  },

  createAllowedWifiLocation: async (req, res) => {
    try {
      const { name = "", ssid, latitude, longitude, radius } = req.body;
      if (!ssid || latitude == null || longitude == null) {
        return res
          .status(400)
          .json({ message: "ssid, latitude, longitude là bắt buộc" });
      }

      const existing = await AllowedWifiLocationModel.findOne({
        ssid,
        isDeleted: false,
      });
      if (existing) {
        return res.status(400).json({ message: `SSID "${ssid}" đã tồn tại` });
      }

      const payload = { name, ssid, latitude, longitude };
      if (radius != null) payload.radius = radius;

      const doc = await AllowedWifiLocationModel.create(payload);
      res.json({ message: "Tạo điểm chấm công thành công", data: doc });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Lỗi server.", error: error.message });
    }
  },

  deleteAllowedWifiLocation: async (req, res) => {
    try {
      const { id } = req.params;
      const doc = await AllowedWifiLocationModel.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { isDeleted: true },
        { new: true },
      );
      if (!doc)
        return res
          .status(404)
          .json({ message: "Không tìm thấy điểm chấm công" });
      res.json({ message: "Xóa điểm chấm công thành công" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Lỗi server.", error: error.message });
    }
  },

  createShift: async (req, res) => {
    try {
      const {
        name,
        start_time,
        end_time,
        late_allowance_minutes = 0,
      } = req.body;
      if (!name || !start_time || !end_time) {
        return res
          .status(400)
          .json({ message: "name, start_time, end_time là bắt buộc" });
      }

      const existing = await ShiftModel.findOne({ name });
      if (existing)
        return res.status(400).json({ message: `Shift ${name} đã tồn tại` });

      const shift = await ShiftModel.create({
        name,
        start_time,
        end_time,
        late_allowance_minutes,
      });
      return res
        .status(201)
        .json({ message: "Tạo ca làm việc thành công", data: shift });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ message: "Lỗi server", error: err.message });
    }
  },

  checkIn: async (req, res) => {
    try {
      const { ssid, latitude, longitude } = req.body;
      if (!ssid || latitude == null || longitude == null)
        return res
          .status(400)
          .json({ message: "ssid, latitude, longitude required" });

      const allowed = await AllowedWifiLocationModel.findOne({
        ssid,
        isDeleted: false,
      });
      if (!allowed)
        return res.status(400).json({ message: "SSID không hợp lệ." });

      // Kiểm tra khoảng cách
      const R = 6371000;
      const toRad = (x) => (x * Math.PI) / 180;
      const dLat = toRad(latitude - allowed.latitude);
      const dLon = toRad(longitude - allowed.longitude);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(latitude)) *
          Math.cos(toRad(allowed.latitude)) *
          Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      if (distance > allowed.radius)
        return res.status(400).json({ message: "Vị trí không hợp lệ." });

      const accountId = req.account._id;
      const userInfo = await UserInfoModel.findOne({ id_account: accountId });
      if (!userInfo)
        return res.status(400).json({ message: "User info không tồn tại" });

      // Xác định ngày hôm nay theo VN timezone
      const today = moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
      const tomorrow = moment(today).add(1, "day").toDate();

      // Lấy worksheet
      const worksheet = await WorkSheetModel.findOne({
        user_id: userInfo._id,
        date: { $gte: today, $lt: tomorrow },
      }).populate("shifts");

      if (!worksheet)
        return res
          .status(400)
          .json({ message: "Bạn chưa có ca làm việc hôm nay." });
      if (worksheet.check_in)
        return res
          .status(400)
          .json({ message: "Bạn đã check-in hôm nay rồi." });

      if (!worksheet.shifts.length)
        return res
          .status(400)
          .json({ message: "Không có ca làm việc hợp lệ." });

      // Thời gian hiện tại
      const now = moment.tz("Asia/Ho_Chi_Minh");

      // Nếu là part-time và có nhiều ca
      let firstShift = worksheet.shifts[0];
      let lastShift = worksheet.shifts[worksheet.shifts.length - 1];

      // Nếu shifts là ObjectId, fetch lại
      if (
        typeof firstShift === "string" ||
        firstShift instanceof mongoose.Types.ObjectId
      ) {
        firstShift = await ShiftModel.findById(firstShift);
        lastShift = await ShiftModel.findById(lastShift);
      }

      // Kiểm tra quá giờ: nếu nhiều ca thì lấy giờ out ca cuối
      const [lastEndH, lastEndM] = lastShift.end_time.split(":").map(Number);
      const lastShiftEnd = moment
        .tz(today, "Asia/Ho_Chi_Minh")
        .hour(lastEndH)
        .minute(lastEndM);
      if (now.isAfter(lastShiftEnd)) {
        return res
          .status(400)
          .json({ message: "Đã quá giờ làm việc, không thể check-in." });
      }

      // Tính số phút đi muộn dựa vào ca đầu tiên
      const [firstStartH, firstStartM] = firstShift.start_time
        .split(":")
        .map(Number);
      const firstShiftStart = moment
        .tz(today, "Asia/Ho_Chi_Minh")
        .hour(firstStartH)
        .minute(firstStartM);
      const lateMinutes = Math.max(
        0,
        Math.floor((now - firstShiftStart) / 60000) -
          firstShift.late_allowance_minutes,
      );

      worksheet.check_in = now.toDate();
      worksheet.minutes_late = lateMinutes;
      await worksheet.save();

      return res.json({
        message: "Check-in thành công",
        check_in: worksheet.check_in,
        minutes_late: worksheet.minutes_late,
      });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ message: "Lỗi server", error: err.message });
    }
  },

  checkOut: async (req, res) => {
    let session = null;
    try {
      const { ssid, latitude, longitude } = req.body;
      if (!ssid || latitude == null || longitude == null)
        return res
          .status(400)
          .json({ message: "ssid, latitude, longitude required" });

      const allowed = await AllowedWifiLocationModel.findOne({
        ssid,
        isDeleted: false,
      });
      if (!allowed)
        return res.status(400).json({ message: "SSID không hợp lệ." });

      // Kiểm tra khoảng cách
      const R = 6371000;
      const toRad = (x) => (x * Math.PI) / 180;
      const dLat = toRad(latitude - allowed.latitude);
      const dLon = toRad(longitude - allowed.longitude);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(latitude)) *
          Math.cos(toRad(allowed.latitude)) *
          Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      if (distance > allowed.radius)
        return res.status(400).json({ message: "Vị trí không hợp lệ." });

      const accountId = req.account._id;
      const userInfo = await UserInfoModel.findOne({ id_account: accountId });
      if (!userInfo)
        return res.status(400).json({ message: "User info không tồn tại" });

      // Xác định ngày hôm nay VN
      const today = moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
      const tomorrow = moment(today).add(1, "day").toDate();

      // Lấy worksheet hôm nay
      const worksheet = await WorkSheetModel.findOne({
        user_id: userInfo._id,
        date: { $gte: today, $lt: tomorrow },
      }).populate("shifts");

      if (!worksheet)
        return res.status(400).json({
          message: "Bạn chưa có ca làm việc hôm nay, không thể check-out.",
        });
      if (worksheet.check_out)
        return res
          .status(400)
          .json({ message: "Bạn đã check-out hôm nay rồi." });
      if (!worksheet.shifts.length)
        return res
          .status(400)
          .json({ message: "Không có ca làm việc hợp lệ." });

      // Thời gian hiện tại
      const now = moment.tz("Asia/Ho_Chi_Minh");

      // Lấy ca cuối
      let lastShift = worksheet.shifts[worksheet.shifts.length - 1];
      if (
        typeof lastShift === "string" ||
        lastShift instanceof mongoose.Types.ObjectId
      ) {
        lastShift = await ShiftModel.findById(lastShift);
      }

      // Tính phút về sớm dựa trên ca cuối
      const [lastEndH, lastEndM] = lastShift.end_time.split(":").map(Number);
      const lastShiftEnd = moment
        .tz(today, "Asia/Ho_Chi_Minh")
        .hour(lastEndH)
        .minute(lastEndM);
      const minuteEarly = Math.max(0, Math.floor((lastShiftEnd - now) / 60000));

      worksheet.check_out = now.toDate();
      worksheet.minute_early = minuteEarly;

      session = await mongoose.startSession();
      session.startTransaction();

      await worksheet.save({ session });

      await resolveLeaveConflictOnAttendance({
        userId: userInfo._id,
        worksheetId: worksheet._id,
        date: today,
        checkInTime: worksheet.check_in,
        checkOutTime: now.toDate(),
        lastShiftEnd: lastShift.end_time,
        session,
      });

      // Cập nhật WorkDayStatus: pending → present
      await WorkDayStatusModel.updateMany(
        { worksheet_id: worksheet._id, status: "pending", isDeleted: false },
        {
          status: "present",
          $addToSet: {
            sources: { ref_id: worksheet._id, ref_type: "attendance" },
          },
        },
        { session },
      );

      await session.commitTransaction();

      return res.json({
        message: "Check-out thành công",
        check_out: worksheet.check_out,
        minute_early: worksheet.minute_early,
      });
    } catch (err) {
      if (session) await session.abortTransaction().catch(() => {});
      console.error(err);
      return res
        .status(500)
        .json({ message: "Lỗi server", error: err.message });
    } finally {
      if (session) session.endSession();
    }
  },

  getWorkSheet: async (req, res) => {
    try {
      const targetDate = req.query.date
        ? moment.tz(req.query.date, "Asia/Ho_Chi_Minh").startOf("day").toDate()
        : moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
      const nextDate = moment(targetDate).add(1, "day").toDate();

      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user)
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin nhân viên" });

      const [worksheets, statuses] = await Promise.all([
        WorkSheetModel.find({
          user_id: user._id,
          date: { $gte: targetDate, $lt: nextDate },
        })
          .populate("user_id", "full_name ma_nv employment_type")
          .populate(
            "shifts",
            "name start_time end_time late_allowance_minutes",
          ),
        WorkDayStatusModel.find({
          user_id: user._id,
          date: { $gte: targetDate, $lt: nextDate },
          isDeleted: false,
        }),
      ]);

      const statusMap = statuses.reduce((acc, s) => {
        const key = s.worksheet_id.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
      }, {});

      const data = worksheets.map((w) => ({
        ...w.toObject(),
        day_statuses: statusMap[w._id.toString()] || [],
      }));

      res.json({
        message: `WorkSheet ngày ${moment(targetDate).format("DD/MM/YYYY")}`,
        data,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },
  getLichCong: async (req, res) => {
    try {
      // Lấy user từ account
      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user)
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin nhân viên" });

      // Lấy period từ query, mặc định = 0 (kỳ hiện tại)
      const period = parseInt(req.query.period || 0);

      const today = moment.tz("Asia/Ho_Chi_Minh");

      // Xác định kỳ hiện tại dựa vào hôm nay
      let baseStart, baseEnd;

      if (today.date() >= 26) {
        baseStart = today.clone().date(26).startOf("day");
        baseEnd = today.clone().add(1, "month").date(25).endOf("day");
      } else {
        baseStart = today.clone().subtract(1, "month").date(26).startOf("day");
        baseEnd = today.clone().date(25).endOf("day");
      }

      // Dịch kỳ theo period
      const startDate = baseStart.clone().add(period, "month");
      const endDate = baseEnd.clone().add(period, "month");

      const [worksheets, statuses] = await Promise.all([
        WorkSheetModel.find({
          user_id: user._id,
          date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
        })
          .populate("shifts", "name start_time end_time late_allowance_minutes")
          .sort({ date: 1 }),
        WorkDayStatusModel.find({
          user_id: user._id,
          date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
          isDeleted: false,
        }),
      ]);

      const statusMap = statuses.reduce((acc, s) => {
        const key = s.worksheet_id.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
      }, {});

      const data = worksheets.map((w) => ({
        ...w.toObject(),
        day_statuses: statusMap[w._id.toString()] || [],
      }));

      res.json({
        message: `Lịch công từ ${startDate.format("DD/MM/YYYY")} đến ${endDate.format("DD/MM/YYYY")}`,
        data,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },
  getAllWorkSheets: async (req, res) => {
    try {
      const targetDate = req.query.date
        ? moment.tz(req.query.date, "Asia/Ho_Chi_Minh").startOf("day").toDate()
        : moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
      const nextDate = moment(targetDate).add(1, "day").toDate();

      let userIds;

      if (req.account.role === "admin" || req.account.dept_scope === "all") {
        const users = await UserInfoModel.find({ isDeleted: false }, "_id");
        userIds = users.map((u) => u._id);
      } else {
        const myInfo = await UserInfoModel.findOne({
          id_account: req.account._id,
        });
        const myDeptIds = await UserDepartmentPositionModel.distinct(
          "department",
          { user: myInfo._id },
        );
        userIds = await UserDepartmentPositionModel.distinct("user", {
          department: { $in: myDeptIds },
        });
      }

      const [worksheets, statuses] = await Promise.all([
        WorkSheetModel.find({
          user_id: { $in: userIds },
          date: { $gte: targetDate, $lt: nextDate },
        })
          .populate("user_id", "full_name ma_nv employment_type")
          .populate("shifts", "name start_time end_time")
          .sort({ createdAt: 1 }),
        WorkDayStatusModel.find({
          user_id: { $in: userIds },
          date: { $gte: targetDate, $lt: nextDate },
          isDeleted: false,
        }),
      ]);

      const statusMap = statuses.reduce((acc, s) => {
        const key = s.worksheet_id.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
      }, {});

      const data = worksheets.map((w) => ({
        ...w.toObject(),
        day_statuses: statusMap[w._id.toString()] || [],
      }));

      res.json({ message: "OK", data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getAllShifts: async (req, res) => {
    try {
      const shifts = await ShiftModel.find();
      return res.status(200).json({
        message: "Lấy danh sách ca làm việc thành công",
        data: shifts,
      });
    } catch (error) {
      console.error(error);
      return res
        .status(500)
        .json({ message: "Lỗi server", error: error.message });
    }
  },

  getStats: async (req, res) => {
    try {
      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user)
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin nhân viên" });

      const now = moment.tz("Asia/Ho_Chi_Minh");
      const month = parseInt(req.query.month);
      const year = parseInt(req.query.year);
      const selected =
        month && year
          ? moment.tz({ year, month: month - 1, day: 1 }, "Asia/Ho_Chi_Minh")
          : now.clone();

      let periodStart, periodEnd;
      if (selected.date() >= 26 || (month && year)) {
        periodStart = selected.clone().date(26).startOf("day");
        periodEnd = selected.clone().add(1, "month").date(25).endOf("day");
      } else {
        periodStart = selected
          .clone()
          .subtract(1, "month")
          .date(26)
          .startOf("day");
        periodEnd = selected.clone().date(25).endOf("day");
      }

      const [missedCount, absentCount] = await Promise.all([
        WorkDayStatusModel.countDocuments({
          user_id: user._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          status: "missed_clock",
          isDeleted: false,
        }),
        WorkDayStatusModel.countDocuments({
          user_id: user._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          status: "absent",
          isDeleted: false,
        }),
      ]);

      const currentBalance = user.leave_balance?.annual ?? 0;
      const monthDiff = selected
        .clone()
        .startOf("month")
        .diff(now.clone().startOf("month"), "months");
      const projectedBalance = Math.max(
        0,
        currentBalance + monthDiff * MONTHLY_ACCRUAL,
      );

      return res.status(200).json({
        message: "OK",
        data: {
          period: {
            from: periodStart.format("DD/MM/YYYY"),
            to: periodEnd.format("DD/MM/YYYY"),
          },
          missed_clock_days: missedCount,
          absent_days: absentCount,
          leave_balance: projectedBalance,
        },
      });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ message: "Lỗi server", error: err.message });
    }
  },

  getPayrollStats: async (req, res) => {
    const TZ = "Asia/Ho_Chi_Minh";
    try {
      const { userId } = req.params;
      const month = parseInt(req.query.month);
      const year = parseInt(req.query.year);

      if (!mongoose.Types.ObjectId.isValid(userId))
        return res.status(400).json({ message: "userId không hợp lệ" });
      if (!month || !year || month < 1 || month > 12)
        return res
          .status(400)
          .json({ message: "month và year là bắt buộc (month: 1-12)" });

      const refDate = moment.tz({ year, month: month - 1, day: 1 }, TZ);
      const periodStart = refDate
        .clone()
        .subtract(1, "month")
        .date(26)
        .startOf("day");
      const periodEnd = refDate.clone().date(25).endOf("day");

      const userInfo = await UserInfoModel.findOne({
        _id: userId,
        isDeleted: false,
      });
      if (!userInfo)
        return res.status(404).json({ message: "Không tìm thấy nhân viên" });

      if (req.account.role !== "admin" && req.account.dept_scope !== "all") {
        const myInfo = await UserInfoModel.findOne({
          id_account: req.account._id,
          isDeleted: false,
        });
        if (!myInfo)
          return res
            .status(404)
            .json({ message: "Không tìm thấy thông tin quản lý" });

        const [myDeptIds, targetDeptIds] = await Promise.all([
          UserDepartmentPositionModel.distinct("department", {
            user: myInfo._id,
          }),
          UserDepartmentPositionModel.distinct("department", {
            user: userInfo._id,
          }),
        ]);
        const mySet = new Set(myDeptIds.map((id) => id.toString()));
        const hasOverlap = targetDeptIds.some((id) => mySet.has(id.toString()));
        if (!hasOverlap)
          return res
            .status(403)
            .json({ message: "Bạn không có quyền xem nhân viên này" });
      }

      const [worksheets, dayStatuses, requests] = await Promise.all([
        WorkSheetModel.find({
          user_id: userInfo._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          isDeleted: false,
        }),
        WorkDayStatusModel.find({
          user_id: userInfo._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          isDeleted: false,
        }),
        RequestModel.find({
          user_id: userInfo._id,
          isDeleted: false,
          status: "approved",
          $or: [
            {
              from_date: { $lte: periodEnd.toDate() },
              to_date: { $gte: periodStart.toDate() },
            },
            {
              date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
            },
          ],
        }),
      ]);

      const wsMap = new Map();
      for (const ws of worksheets) {
        wsMap.set(moment.tz(ws.date, TZ).format("YYYY-MM-DD"), ws);
      }

      const dsMap = new Map();
      for (const ds of dayStatuses) {
        const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
        if (!dsMap.has(key)) dsMap.set(key, []);
        dsMap.get(key).push(ds);
      }

      const reqMap = new Map();
      const addReqToDay = (dateStr, req) => {
        if (!reqMap.has(dateStr)) reqMap.set(dateStr, []);
        reqMap.get(dateStr).push(req);
      };
      for (const req of requests) {
        if (req.request_type === "leave" || req.request_type === "remote") {
          const cursor = moment.tz(req.from_date, TZ).startOf("day");
          const end = moment.tz(req.to_date, TZ).startOf("day");
          while (cursor.isSameOrBefore(end, "day")) {
            if (cursor.isBetween(periodStart, periodEnd, "day", "[]"))
              addReqToDay(cursor.format("YYYY-MM-DD"), req);
            cursor.add(1, "day");
          }
        } else if (req.date) {
          addReqToDay(moment.tz(req.date, TZ).format("YYYY-MM-DD"), req);
        }
      }

      const allDates = new Set([
        ...wsMap.keys(),
        ...dsMap.keys(),
        ...reqMap.keys(),
      ]);

      let work_unit_total = 0;
      let present_days = 0,
        missed_clock_days = 0,
        absent_days = 0;
      let leave_paid_days = 0,
        leave_unpaid_days = 0,
        remote_days = 0;
      let late_days = 0,
        total_minutes_late = 0,
        early_days = 0,
        total_minutes_early = 0;

      const daily = [...allDates].sort().map((dateStr) => {
        const ws = wsMap.get(dateStr);
        const statuses = dsMap.get(dateStr) || [];
        const reqs = reqMap.get(dateStr) || [];

        if (ws) {
          work_unit_total += ws.work_unit ?? 0;
          if ((ws.minutes_late ?? 0) > 0) {
            late_days++;
            total_minutes_late += ws.minutes_late;
          }
          if ((ws.minute_early ?? 0) > 0) {
            early_days++;
            total_minutes_early += ws.minute_early;
          }
        }
        for (const s of statuses) {
          const w = s.period === "full" ? 1 : 0.5;
          if (s.status === "present") present_days += w;
          else if (s.status === "missed_clock") missed_clock_days += w;
          else if (s.status === "absent") absent_days += w;
          else if (s.status === "leave_paid") leave_paid_days += w;
          else if (s.status === "leave_unpaid") leave_unpaid_days += w;
          else if (s.status === "remote") remote_days += w;
        }

        return {
          date: dateStr,
          check_in: ws?.check_in
            ? moment.tz(ws.check_in, TZ).format("HH:mm")
            : null,
          check_out: ws?.check_out
            ? moment.tz(ws.check_out, TZ).format("HH:mm")
            : null,
          work_unit: ws?.work_unit ?? null,
          minutes_late: ws?.minutes_late ?? 0,
          minute_early: ws?.minute_early ?? 0,
          day_statuses: statuses.map((s) => ({
            period: s.period,
            status: s.status,
          })),
          requests: reqs.map((r) => {
            const base = {
              _id: r._id,
              request_type: r.request_type,
              reason: r.reason || "",
            };
            switch (r.request_type) {
              case "leave":
                return {
                  ...base,
                  from_date: moment.tz(r.from_date, TZ).format("DD/MM/YYYY"),
                  to_date: moment.tz(r.to_date, TZ).format("DD/MM/YYYY"),
                  leave_type: r.leave_type,
                  paid_days: r.paid_days,
                  unpaid_days: r.unpaid_days,
                };
              case "forgot_checkin":
                return {
                  ...base,
                  forgot_type: r.type,
                  expected_check_in: r.expected_check_in
                    ? moment.tz(r.expected_check_in, TZ).format("HH:mm")
                    : null,
                  expected_check_out: r.expected_check_out
                    ? moment.tz(r.expected_check_out, TZ).format("HH:mm")
                    : null,
                };
              case "late_early":
                return {
                  ...base,
                  late_type: r.type,
                  minutes: r.minutes,
                };
              case "remote":
                return {
                  ...base,
                  from_date: moment.tz(r.from_date, TZ).format("DD/MM/YYYY"),
                  to_date: moment.tz(r.to_date, TZ).format("DD/MM/YYYY"),
                  total_days: r.total_days,
                };
              case "explanation":
                return { ...base, content: r.content };
              default:
                return base;
            }
          }),
        };
      });

      return res.status(200).json({
        message: "OK",
        period: {
          from: periodStart.format("DD/MM/YYYY"),
          to: periodEnd.format("DD/MM/YYYY"),
        },
        user: {
          user_id: userInfo._id,
          ma_nv: userInfo.ma_nv,
          full_name: userInfo.full_name,
          employment_type: userInfo.employment_type,
          leave_balance:
            userInfo.leave_balance?.annual >= 0
              ? userInfo.leave_balance?.annual
              : 0,
        },
        summary: {
          work_unit_total,
          present_days,
          missed_clock_days,
          absent_days,
          leave_paid_days,
          leave_unpaid_days,
          remote_days,
          late_days,
          total_minutes_late,
          early_days,
          total_minutes_early,
        },
        daily,
      });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ message: "Lỗi server", error: err.message });
    }
  },

  getCalendar: async (req, res) => {
    try {
      const month = parseInt(req.query.month);
      const year = parseInt(req.query.year);
      if (!month || !year || month < 1 || month > 12)
        return res
          .status(400)
          .json({ message: "month và year là bắt buộc (month: 1-12)" });

      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user)
        return res
          .status(404)
          .json({ message: "Không tìm thấy thông tin nhân viên" });

      const startOfMonth = moment
        .tz({ year, month: month - 1, day: 1 }, "Asia/Ho_Chi_Minh")
        .startOf("day");
      const endOfMonth = startOfMonth.clone().endOf("month");

      const [holidays, dayStatuses] = await Promise.all([
        HolidayModel.find(
          {
            date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
            isDeleted: false,
          },
          "date name",
        ),
        WorkDayStatusModel.find(
          {
            user_id: user._id,
            date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
            status: { $in: ["leave_paid", "leave_unpaid", "absent"] },
            isDeleted: false,
          },
          "date period status",
        ),
      ]);

      return res.status(200).json({
        message: "OK",
        data: {
          month,
          year,
          holidays: holidays.map((h) => ({
            date: moment.tz(h.date, "Asia/Ho_Chi_Minh").format("YYYY-MM-DD"),
            name: h.name,
          })),
          day_statuses: dayStatuses.map((s) => ({
            date: moment.tz(s.date, "Asia/Ho_Chi_Minh").format("YYYY-MM-DD"),
            period: s.period,
            status: s.status,
          })),
        },
      });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ message: "Lỗi server", error: err.message });
    }
  },
};

module.exports = AttendanceController;
