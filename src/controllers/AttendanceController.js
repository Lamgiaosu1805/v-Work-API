const { default: mongoose } = require("mongoose");
const moment = require("moment-timezone");
const AllowedWifiLocationModel = require("../models/AllowedWifiLocationModel");
const ShiftModel = require("../models/ShiftModel");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const HolidayModel = require("../models/HolidayModel");
const AttendanceMachineMappingModel = require("../models/AttendanceMachineMappingModel");
const { RequestModel } = require("../models/RequestModel");
const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");
const { resolveLeaveConflictOnAttendance } = require("../helpers/leaveHandler");
const { getLeaveBalance } = require("../helpers/leaveBalance");
const { can } = require("../helpers/rbac");
const { PERMISSION } = require("../constants");
const {
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver
} = require("../helpers/attendancePenalty");
const {
  parseExcelToBlocks,
  parseDayRows,
  resolveAttendanceDay,
  saveAttendanceDay
} = require("../helpers/attendanceHelper");

const AttendanceController = {
  getAllowedWifiLocations: async (req, res) => {
    try {
      const docs = await AllowedWifiLocationModel.find({
        isDeleted: false
      }).sort({ createdAt: -1 });
      res.json({
        message: "Lấy danh sách điểm chấm công thành công",
        data: docs
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
        return res.status(400).json({ message: "ssid, latitude, longitude là bắt buộc" });
      }

      const existing = await AllowedWifiLocationModel.findOne({
        ssid,
        isDeleted: false
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
        { new: true }
      );
      if (!doc) return res.status(404).json({ message: "Không tìm thấy điểm chấm công" });
      res.json({ message: "Xóa điểm chấm công thành công" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Lỗi server.", error: error.message });
    }
  },

  createShift: async (req, res) => {
    try {
      const { name, start_time, end_time, late_allowance_minutes = 0 } = req.body;
      if (!name || !start_time || !end_time) {
        return res.status(400).json({ message: "name, start_time, end_time là bắt buộc" });
      }

      const existing = await ShiftModel.findOne({ name });
      if (existing) return res.status(400).json({ message: `Shift ${name} đã tồn tại` });

      const shift = await ShiftModel.create({
        name,
        start_time,
        end_time,
        late_allowance_minutes
      });
      return res.status(201).json({ message: "Tạo ca làm việc thành công", data: shift });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  checkIn: async (req, res) => {
    try {
      const { ssid, latitude, longitude } = req.body;
      if (!ssid || latitude == null || longitude == null)
        return res.status(400).json({ message: "ssid, latitude, longitude required" });

      const allowed = await AllowedWifiLocationModel.findOne({
        ssid,
        isDeleted: false
      });
      if (!allowed) return res.status(400).json({ message: "SSID không hợp lệ." });

      const R = 6371000;
      const toRad = (x) => (x * Math.PI) / 180;
      const dLat = toRad(latitude - allowed.latitude);
      const dLon = toRad(longitude - allowed.longitude);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(latitude)) * Math.cos(toRad(allowed.latitude)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      if (distance > allowed.radius)
        return res.status(400).json({ message: "Vị trí không hợp lệ." });

      const accountId = req.account._id;
      const userInfo = await UserInfoModel.findOne({ id_account: accountId });
      if (!userInfo) return res.status(400).json({ message: "User info không tồn tại" });

      const today = moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
      const tomorrow = moment(today).add(1, "day").toDate();

      const worksheet = await WorkSheetModel.findOne({
        user_id: userInfo._id,
        date: { $gte: today, $lt: tomorrow },
        isDeleted: false
      }).populate("shifts");

      if (!worksheet) return res.status(400).json({ message: "Bạn chưa có ca làm việc hôm nay." });
      if (worksheet.check_in)
        return res.status(400).json({ message: "Bạn đã check-in hôm nay rồi." });

      if (!worksheet.shifts.length)
        return res.status(400).json({ message: "Không có ca làm việc hợp lệ." });

      const now = moment.tz("Asia/Ho_Chi_Minh");

      let firstShift = worksheet.shifts[0];
      let lastShift = worksheet.shifts[worksheet.shifts.length - 1];

      if (typeof firstShift === "string" || firstShift instanceof mongoose.Types.ObjectId) {
        firstShift = await ShiftModel.findById(firstShift);
        lastShift = await ShiftModel.findById(lastShift);
      }

      const [lastEndH, lastEndM] = lastShift.end_time.split(":").map(Number);
      const lastShiftEnd = moment.tz(today, "Asia/Ho_Chi_Minh").hour(lastEndH).minute(lastEndM);
      if (now.isAfter(lastShiftEnd)) {
        return res.status(400).json({ message: "Đã quá giờ làm việc, không thể check-in." });
      }

      const [firstStartH, firstStartM] = firstShift.start_time.split(":").map(Number);
      const firstShiftStart = moment
        .tz(today, "Asia/Ho_Chi_Minh")
        .hour(firstStartH)
        .minute(firstStartM);
      const lateMinutes = Math.max(
        0,
        Math.floor((now - firstShiftStart) / 60000) - firstShift.late_allowance_minutes
      );

      worksheet.check_in = now.toDate();
      worksheet.minutes_late = lateMinutes;
      await worksheet.save();

      return res.json({
        message: "Check-in thành công",
        check_in: worksheet.check_in,
        minutes_late: worksheet.minutes_late
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  checkOut: async (req, res) => {
    let session = null;
    try {
      const { ssid, latitude, longitude } = req.body;
      if (!ssid || latitude == null || longitude == null)
        return res.status(400).json({ message: "ssid, latitude, longitude required" });

      const allowed = await AllowedWifiLocationModel.findOne({
        ssid,
        isDeleted: false
      });
      if (!allowed) return res.status(400).json({ message: "SSID không hợp lệ." });

      const R = 6371000;
      const toRad = (x) => (x * Math.PI) / 180;
      const dLat = toRad(latitude - allowed.latitude);
      const dLon = toRad(longitude - allowed.longitude);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(latitude)) * Math.cos(toRad(allowed.latitude)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      if (distance > allowed.radius)
        return res.status(400).json({ message: "Vị trí không hợp lệ." });

      const accountId = req.account._id;
      const userInfo = await UserInfoModel.findOne({ id_account: accountId });
      if (!userInfo) return res.status(400).json({ message: "User info không tồn tại" });

      const today = moment.tz("Asia/Ho_Chi_Minh").startOf("day").toDate();
      const tomorrow = moment(today).add(1, "day").toDate();

      const worksheet = await WorkSheetModel.findOne({
        user_id: userInfo._id,
        date: { $gte: today, $lt: tomorrow },
        isDeleted: false
      }).populate("shifts");

      if (!worksheet)
        return res.status(400).json({
          message: "Bạn chưa có ca làm việc hôm nay, không thể check-out."
        });
      if (worksheet.check_out)
        return res.status(400).json({ message: "Bạn đã check-out hôm nay rồi." });
      if (!worksheet.shifts.length)
        return res.status(400).json({ message: "Không có ca làm việc hợp lệ." });

      const now = moment.tz("Asia/Ho_Chi_Minh");

      let lastShift = worksheet.shifts[worksheet.shifts.length - 1];
      if (typeof lastShift === "string" || lastShift instanceof mongoose.Types.ObjectId) {
        lastShift = await ShiftModel.findById(lastShift);
      }

      const [lastEndH, lastEndM] = lastShift.end_time.split(":").map(Number);
      const lastShiftEnd = moment.tz(today, "Asia/Ho_Chi_Minh").hour(lastEndH).minute(lastEndM);
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
        session
      });

      await WorkDayStatusModel.updateMany(
        { worksheet_id: worksheet._id, status: "pending", isDeleted: false },
        {
          status: "present",
          $addToSet: {
            sources: { ref_id: worksheet._id, ref_type: "attendance" }
          }
        },
        { session }
      );

      await session.commitTransaction();

      return res.json({
        message: "Check-out thành công",
        check_out: worksheet.check_out,
        minute_early: worksheet.minute_early
      });
    } catch (err) {
      if (session) await session.abortTransaction().catch(() => {});
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
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
      if (!user) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      const [worksheets, statuses] = await Promise.all([
        WorkSheetModel.find({
          user_id: user._id,
          date: { $gte: targetDate, $lt: nextDate }
        })
          .populate("user_id", "full_name ma_nv employment_type")
          .populate("shifts", "name start_time end_time late_allowance_minutes"),
        WorkDayStatusModel.find({
          user_id: user._id,
          date: { $gte: targetDate, $lt: nextDate },
          isDeleted: false
        })
      ]);

      const statusMap = statuses.reduce((acc, s) => {
        const key = s.worksheet_id.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
      }, {});

      const data = worksheets.map((w) => ({
        ...w.toObject(),
        day_statuses: statusMap[w._id.toString()] || []
      }));

      res.json({
        message: `WorkSheet ngày ${moment(targetDate).format("DD/MM/YYYY")}`,
        data
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },
  getLichCong: async (req, res) => {
    try {
      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      const period = parseInt(req.query.period || 0, 10);

      const today = moment.tz("Asia/Ho_Chi_Minh");

      let baseStart;
      let baseEnd;

      if (today.date() >= 26) {
        baseStart = today.clone().date(26).startOf("day");
        baseEnd = today.clone().add(1, "month").date(25).endOf("day");
      } else {
        baseStart = today.clone().subtract(1, "month").date(26).startOf("day");
        baseEnd = today.clone().date(25).endOf("day");
      }

      const startDate = baseStart.clone().add(period, "month");
      const endDate = baseEnd.clone().add(period, "month");

      const [worksheets, statuses] = await Promise.all([
        WorkSheetModel.find({
          user_id: user._id,
          date: { $gte: startDate.toDate(), $lte: endDate.toDate() }
        })
          .populate("shifts", "name start_time end_time late_allowance_minutes")
          .sort({ date: 1 }),
        WorkDayStatusModel.find({
          user_id: user._id,
          date: { $gte: startDate.toDate(), $lte: endDate.toDate() },
          isDeleted: false
        })
      ]);

      const statusMap = statuses.reduce((acc, s) => {
        const key = s.worksheet_id.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
      }, {});

      const data = worksheets.map((w) => ({
        ...w.toObject(),
        day_statuses: statusMap[w._id.toString()] || []
      }));

      res.json({
        message: `Lịch công từ ${startDate.format("DD/MM/YYYY")} đến ${endDate.format("DD/MM/YYYY")}`,
        data
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

      const hasViewAll =
        req.account.role === "admin" ||
        req.account.dept_scope === "all" ||
        (await can(req.account, PERMISSION.HRM_REQUEST_VIEW_ALL));

      if (hasViewAll) {
        const users = await UserInfoModel.find({ isDeleted: false }, "_id");
        userIds = users.map((u) => u._id);
      } else {
        const myInfo = await UserInfoModel.findOne({
          id_account: req.account._id
        });
        const myDeptIds = await UserDepartmentPositionModel.distinct("department", {
          user: myInfo._id
        });
        userIds = await UserDepartmentPositionModel.distinct("user", {
          department: { $in: myDeptIds }
        });
      }

      const [worksheets, statuses] = await Promise.all([
        WorkSheetModel.find({
          user_id: { $in: userIds },
          date: { $gte: targetDate, $lt: nextDate }
        })
          .populate("user_id", "full_name ma_nv employment_type")
          .populate("shifts", "name start_time end_time")
          .sort({ createdAt: 1 }),
        WorkDayStatusModel.find({
          user_id: { $in: userIds },
          date: { $gte: targetDate, $lt: nextDate },
          isDeleted: false
        })
      ]);

      const statusMap = statuses.reduce((acc, s) => {
        const key = s.worksheet_id.toString();
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
      }, {});

      const data = worksheets.map((w) => ({
        ...w.toObject(),
        day_statuses: statusMap[w._id.toString()] || []
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
        data: shifts
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Lỗi server", error: error.message });
    }
  },

  getStats: async (req, res) => {
    try {
      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      const now = moment.tz("Asia/Ho_Chi_Minh");
      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);
      const selected =
        month && year
          ? moment.tz({ year, month: month - 1, day: 1 }, "Asia/Ho_Chi_Minh")
          : now.clone();

      let periodStart;
      let periodEnd;
      if (selected.date() >= 26 || (month && year)) {
        periodStart = selected.clone().date(26).startOf("day");
        periodEnd = selected.clone().add(1, "month").date(25).endOf("day");
      } else {
        periodStart = selected.clone().subtract(1, "month").date(26).startOf("day");
        periodEnd = selected.clone().date(25).endOf("day");
      }

      const [missedCount, absentCount] = await Promise.all([
        WorkDayStatusModel.countDocuments({
          user_id: user._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          status: "missed_clock",
          isDeleted: false
        }),
        WorkDayStatusModel.countDocuments({
          user_id: user._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          status: "absent",
          isDeleted: false
        })
      ]);

      const currentBalance = await getLeaveBalance(user._id);
      const monthDiff = selected
        .clone()
        .startOf("month")
        .diff(now.clone().startOf("month"), "months");
      const projectedBalance = Math.max(0, currentBalance + monthDiff * MONTHLY_ACCRUAL);

      return res.status(200).json({
        message: "OK",
        data: {
          period: {
            from: periodStart.format("DD/MM/YYYY"),
            to: periodEnd.format("DD/MM/YYYY")
          },
          missed_clock_days: missedCount,
          absent_days: absentCount,
          leave_balance: projectedBalance
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getPayrollStats: async (req, res) => {
    const TZ = "Asia/Ho_Chi_Minh";
    try {
      const { userId } = req.params;
      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);

      if (!mongoose.Types.ObjectId.isValid(userId))
        return res.status(400).json({ message: "userId không hợp lệ" });
      if (!month || !year || month < 1 || month > 12)
        return res.status(400).json({ message: "month và year là bắt buộc (month: 1-12)" });

      const refDate = moment.tz({ year, month: month - 1, day: 1 }, TZ);
      const periodStart = refDate.clone().subtract(1, "month").date(26).startOf("day");
      const periodEnd = refDate.clone().date(25).endOf("day");

      const userInfo = await UserInfoModel.findOne({
        _id: userId,
        isDeleted: false
      });
      if (!userInfo) return res.status(404).json({ message: "Không tìm thấy nhân viên" });

      const hasViewAll =
        req.account.role === "admin" ||
        req.account.dept_scope === "all" ||
        (await can(req.account, PERMISSION.HRM_REQUEST_VIEW_ALL));

      if (!hasViewAll) {
        const myInfo = await UserInfoModel.findOne({
          id_account: req.account._id,
          isDeleted: false
        });
        if (!myInfo) return res.status(404).json({ message: "Không tìm thấy thông tin quản lý" });

        const [myDeptIds, targetDeptIds] = await Promise.all([
          UserDepartmentPositionModel.distinct("department", {
            user: myInfo._id
          }),
          UserDepartmentPositionModel.distinct("department", {
            user: userInfo._id
          })
        ]);
        const mySet = new Set(myDeptIds.map((id) => id.toString()));
        const hasOverlap = targetDeptIds.some((id) => mySet.has(id.toString()));
        if (!hasOverlap)
          return res.status(403).json({ message: "Bạn không có quyền xem nhân viên này" });
      }

      const [worksheets, dayStatuses, requests, forgotRequests] = await Promise.all([
        WorkSheetModel.find({
          user_id: userInfo._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          isDeleted: false
        }),
        WorkDayStatusModel.find({
          user_id: userInfo._id,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          isDeleted: false
        }),
        RequestModel.find({
          user_id: userInfo._id,
          isDeleted: false,
          status: "approved",
          $or: [
            {
              from_date: { $lte: periodEnd.toDate() },
              to_date: { $gte: periodStart.toDate() }
            },
            {
              date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() }
            }
          ]
        }),
        RequestModel.find({
          user_id: userInfo._id,
          request_type: "forgot_checkin",
          status: { $in: ["pending", "approved"] },
          isDeleted: false,
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() }
        })
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
      const addReqToDay = (dateStr, reqItem) => {
        if (!reqMap.has(dateStr)) reqMap.set(dateStr, []);
        reqMap.get(dateStr).push(reqItem);
      };
      for (const reqItem of requests) {
        if (reqItem.request_type === "leave" || reqItem.request_type === "remote") {
          const cursor = moment.tz(reqItem.from_date, TZ).startOf("day");
          const end = moment.tz(reqItem.to_date, TZ).startOf("day");
          while (cursor.isSameOrBefore(end, "day")) {
            if (cursor.isBetween(periodStart, periodEnd, "day", "[]"))
              addReqToDay(cursor.format("YYYY-MM-DD"), reqItem);
            cursor.add(1, "day");
          }
        } else if (reqItem.date) {
          addReqToDay(moment.tz(reqItem.date, TZ).format("YYYY-MM-DD"), reqItem);
        }
      }

      const forgotReqMap = new Map();
      for (const r of forgotRequests) {
        if (r.date) forgotReqMap.set(moment.tz(r.date, TZ).format("YYYY-MM-DD"), r);
      }

      const allDates = new Set([
        ...wsMap.keys(),
        ...dsMap.keys(),
        ...reqMap.keys(),
        ...forgotReqMap.keys()
      ]);

      let work_unit_total = 0;
      let work_unit_official = 0;
      let work_unit_probation = 0;
      let penalty_amount_total = 0;
      let present_days = 0;
      let missed_clock_days = 0;
      let absent_days = 0;
      let leave_paid_days = 0;
      let leave_unpaid_days = 0;
      let remote_days = 0;
      let business_trip_days = 0;
      let client_visit_days = 0;
      let late_days = 0;
      let total_minutes_late = 0;
      let early_days = 0;
      let total_minutes_early = 0;

      const probationEnd = userInfo.probation_end_date
        ? moment.tz(userInfo.probation_end_date, TZ).startOf("day")
        : null;

      const daily = [...allDates].sort().map((dateStr) => {
        const ws = wsMap.get(dateStr);
        const statuses = dsMap.get(dateStr) || [];
        const reqs = reqMap.get(dateStr) || [];

        if (ws) {
          const wu = ws.work_unit ?? 0;
          work_unit_total += wu;
          const isProbation = probationEnd && moment.tz(dateStr, TZ).isBefore(probationEnd, "day");
          if (isProbation) work_unit_probation += wu;
          else work_unit_official += wu;
          penalty_amount_total += ws.penalty_amount ?? 0;
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
          else if (s.status === "business_trip") business_trip_days += w;
          else if (s.status === "client_visit") client_visit_days += w;
        }

        return {
          date: dateStr,
          worksheet_id: ws?._id ?? null,
          check_in: ws?.check_in ? moment.tz(ws.check_in, TZ).format("HH:mm") : null,
          check_out: ws?.check_out ? moment.tz(ws.check_out, TZ).format("HH:mm") : null,
          work_unit: ws?.work_unit ?? null,
          penalty_amount: ws?.penalty_amount ?? 0,
          minutes_late: ws?.minutes_late ?? 0,
          minute_early: ws?.minute_early ?? 0,
          day_statuses: statuses.map((s) => ({
            period: s.period,
            status: s.status
          })),

          forgot_request: (() => {
            const r = forgotReqMap.get(dateStr);
            if (!r) return null;
            return {
              _id: r._id,
              status: r.status,
              forgot_type: r.type,
              expected_check_in: r.expected_check_in
                ? moment.tz(r.expected_check_in, TZ).format("HH:mm")
                : null,
              expected_check_out: r.expected_check_out
                ? moment.tz(r.expected_check_out, TZ).format("HH:mm")
                : null,
              reason: r.reason || ""
            };
          })(),
          requests: reqs.map((r) => {
            const base = {
              _id: r._id,
              request_type: r.request_type,
              reason: r.reason || ""
            };
            switch (r.request_type) {
              case "leave":
                return {
                  ...base,
                  from_date: moment.tz(r.from_date, TZ).format("DD/MM/YYYY"),
                  to_date: moment.tz(r.to_date, TZ).format("DD/MM/YYYY"),
                  leave_type: r.leave_type,
                  paid_days: r.paid_days,
                  unpaid_days: r.unpaid_days
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
                    : null
                };
              case "late_early":
                return {
                  ...base,
                  late_type: r.type,
                  minutes: r.minutes
                };
              case "remote":
                return {
                  ...base,
                  from_date: moment.tz(r.from_date, TZ).format("DD/MM/YYYY"),
                  to_date: moment.tz(r.to_date, TZ).format("DD/MM/YYYY"),
                  total_days: r.total_days
                };
              case "explanation":
                return { ...base, content: r.content };
              default:
                return base;
            }
          })
        };
      });

      return res.status(200).json({
        message: "OK",
        period: {
          from: periodStart.format("DD/MM/YYYY"),
          to: periodEnd.format("DD/MM/YYYY")
        },
        user: {
          user_id: userInfo._id,
          ma_nv: userInfo.ma_nv,
          full_name: userInfo.full_name,
          employment_type: userInfo.employment_type,
          probation_end_date: userInfo.probation_end_date
            ? moment.tz(userInfo.probation_end_date, TZ).format("DD/MM/YYYY")
            : null,
          leave_balance: Math.max(0, await getLeaveBalance(userInfo._id))
        },
        summary: {
          work_unit_total,
          work_unit_official,
          work_unit_probation,
          penalty_amount_total,
          present_days,
          missed_clock_days,
          absent_days,
          leave_paid_days,
          leave_unpaid_days,
          remote_days,
          business_trip_days,
          client_visit_days,
          late_days,
          total_minutes_late,
          early_days,
          total_minutes_early
        },
        daily
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getPayrollStatsAll: async (req, res) => {
    const TZ = "Asia/Ho_Chi_Minh";
    try {
      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);
      if (!month || !year || month < 1 || month > 12)
        return res.status(400).json({ message: "month và year là bắt buộc (month: 1-12)" });

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
      const { department, q } = req.query;

      const refDate = moment.tz({ year, month: month - 1, day: 1 }, TZ);
      const periodStart = refDate.clone().subtract(1, "month").date(26).startOf("day");
      const periodEnd = refDate.clone().date(25).endOf("day");

      const userFilter = { isDeleted: false };
      const hasViewAll =
        req.account.role === "admin" ||
        req.account.dept_scope === "all" ||
        (await can(req.account, PERMISSION.HRM_REQUEST_VIEW_ALL));

      if (!hasViewAll) {
        const myInfo = await UserInfoModel.findOne({
          id_account: req.account._id,
          isDeleted: false
        });
        if (!myInfo) return res.status(404).json({ message: "Không tìm thấy thông tin quản lý" });
        const myDeptIds = await UserDepartmentPositionModel.distinct("department", {
          user: myInfo._id
        });
        const memberUserIds = await UserDepartmentPositionModel.distinct("user", {
          department: { $in: myDeptIds }
        });
        userFilter._id = { $in: memberUserIds };
      }

      if (department && mongoose.Types.ObjectId.isValid(department)) {
        const deptUserIds = await UserDepartmentPositionModel.distinct("user", {
          department
        });
        if (userFilter._id) {
          const allowed = new Set(userFilter._id.$in.map(String));
          userFilter._id = {
            $in: deptUserIds.filter((id) => allowed.has(String(id)))
          };
        } else {
          userFilter._id = { $in: deptUserIds };
        }
      }

      if (q && q.trim()) {
        const kw = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        userFilter.$or = [
          { full_name: { $regex: kw, $options: "i" } },
          { ma_nv: { $regex: kw, $options: "i" } }
        ];
      }

      const totalUsers = await UserInfoModel.countDocuments(userFilter);
      const users = await UserInfoModel.find(
        userFilter,
        "ma_nv full_name probation_end_date employment_type"
      )
        .sort({ ma_nv: 1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const userIds = users.map((u) => u._id);

      const [worksheets, dayStatuses] = await Promise.all([
        WorkSheetModel.find({
          user_id: { $in: userIds },
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          isDeleted: false
        }),
        WorkDayStatusModel.find({
          user_id: { $in: userIds },
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          isDeleted: false
        })
      ]);

      const wsByUser = new Map();
      for (const ws of worksheets) {
        const k = ws.user_id.toString();
        if (!wsByUser.has(k)) wsByUser.set(k, []);
        wsByUser.get(k).push(ws);
      }
      const dsByUser = new Map();
      for (const ds of dayStatuses) {
        const k = ds.user_id.toString();
        if (!dsByUser.has(k)) dsByUser.set(k, []);
        dsByUser.get(k).push(ds);
      }

      const data = users.map((u) => {
        const uid = u._id.toString();
        const wss = wsByUser.get(uid) || [];
        const dss = dsByUser.get(uid) || [];

        const probationEnd = u.probation_end_date
          ? moment.tz(u.probation_end_date, TZ).startOf("day")
          : null;

        let work_unit_total = 0;
        let work_unit_official = 0;
        let work_unit_probation = 0;
        let penalty_amount_total = 0;
        let late_days = 0;
        let total_minutes_late = 0;
        let early_days = 0;
        let total_minutes_early = 0;

        for (const ws of wss) {
          const wu = ws.work_unit ?? 0;
          work_unit_total += wu;
          const isProbation = probationEnd && moment.tz(ws.date, TZ).isBefore(probationEnd, "day");
          if (isProbation) work_unit_probation += wu;
          else work_unit_official += wu;
          penalty_amount_total += ws.penalty_amount ?? 0;
          if ((ws.minutes_late ?? 0) > 0) {
            late_days++;
            total_minutes_late += ws.minutes_late;
          }
          if ((ws.minute_early ?? 0) > 0) {
            early_days++;
            total_minutes_early += ws.minute_early;
          }
        }

        let present_days = 0;
        let missed_clock_days = 0;
        let absent_days = 0;
        let leave_paid_days = 0;
        let leave_unpaid_days = 0;
        let remote_days = 0;
        let business_trip_days = 0;
        let client_visit_days = 0;
        for (const s of dss) {
          const w = s.period === "full" ? 1 : 0.5;
          if (s.status === "present") present_days += w;
          else if (s.status === "missed_clock") missed_clock_days += w;
          else if (s.status === "absent") absent_days += w;
          else if (s.status === "leave_paid") leave_paid_days += w;
          else if (s.status === "leave_unpaid") leave_unpaid_days += w;
          else if (s.status === "remote") remote_days += w;
          else if (s.status === "business_trip") business_trip_days += w;
          else if (s.status === "client_visit") client_visit_days += w;
        }

        return {
          user_id: u._id,
          ma_nv: u.ma_nv,
          full_name: u.full_name,
          employment_type: u.employment_type,
          probation_end_date: u.probation_end_date
            ? moment.tz(u.probation_end_date, TZ).format("DD/MM/YYYY")
            : null,
          work_unit_total,
          work_unit_official,
          work_unit_probation,
          penalty_amount_total,
          present_days,
          missed_clock_days,
          absent_days,
          leave_paid_days,
          leave_unpaid_days,
          remote_days,
          business_trip_days,
          client_visit_days,
          late_days,
          total_minutes_late,
          early_days,
          total_minutes_early
        };
      });

      return res.status(200).json({
        message: "OK",
        period: {
          from: periodStart.format("DD/MM/YYYY"),
          to: periodEnd.format("DD/MM/YYYY")
        },
        pagination: {
          page,
          limit,
          total: totalUsers,
          total_pages: Math.ceil(totalUsers / limit)
        },
        data
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getCalendar: async (req, res) => {
    try {
      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);
      if (!month || !year || month < 1 || month > 12)
        return res.status(400).json({ message: "month và year là bắt buộc (month: 1-12)" });

      const user = await UserInfoModel.findOne({ id_account: req.account._id });
      if (!user) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      const startOfMonth = moment
        .tz({ year, month: month - 1, day: 1 }, "Asia/Ho_Chi_Minh")
        .startOf("day");
      const endOfMonth = startOfMonth.clone().endOf("month");

      const [holidays, dayStatuses] = await Promise.all([
        HolidayModel.find(
          {
            date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
            isDeleted: false
          },
          "date name"
        ),
        WorkDayStatusModel.find(
          {
            user_id: user._id,
            date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
            status: { $in: ["leave_paid", "leave_unpaid", "absent"] },
            isDeleted: false
          },
          "date period status"
        )
      ]);

      return res.status(200).json({
        message: "OK",
        data: {
          month,
          year,
          holidays: holidays.map((h) => ({
            date: moment.tz(h.date, "Asia/Ho_Chi_Minh").format("YYYY-MM-DD"),
            name: h.name
          })),
          day_statuses: dayStatuses.map((s) => ({
            date: moment.tz(s.date, "Asia/Ho_Chi_Minh").format("YYYY-MM-DD"),
            period: s.period,
            status: s.status
          }))
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  importExcel: async (req, res) => {
    const TZ = "Asia/Ho_Chi_Minh";
    try {
      if (!req.file) return res.status(400).json({ message: "Chưa upload file" });

      let blocks;
      try {
        blocks = parseExcelToBlocks(req.file.buffer);
      } catch (e) {
        console.error("[importExcel] Lỗi đọc file:", e);
        return res.status(400).json({
          message: "Không đọc được file Excel. Kiểm tra lại định dạng file (.xlsx)."
        });
      }
      if (!blocks.length)
        return res.status(400).json({
          message: "File không đúng định dạng bảng chấm công (không tìm thấy nhân viên nào)."
        });

      const allMappings = await AttendanceMachineMappingModel.find({
        isDeleted: false
      });
      if (!allMappings.length)
        return res.status(400).json({
          message:
            "Chưa cấu hình mapping mã máy chấm công với nhân viên. Vui lòng tạo mapping trước khi import."
        });
      const mappingMap = new Map(allMappings.map((m) => [m.machine_code, m.user_id]));

      const resolveLatePenalty = await buildLatePenaltyResolver();
      const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
      const resolveForgotPenalty = await buildForgotPenaltyResolver();

      const unmatched = [];
      const failures = [];
      let imported = 0;
      let skipped = 0;
      let unchanged = 0;

      for (const block of blocks) {
        const userId = mappingMap.get(block.machine_code);
        if (!userId) {
          unmatched.push(block.machine_code);
          continue;
        }

        const dayRows = parseDayRows(block);
        if (!dayRows.length) continue;

        let worksheetMap;
        let forgotMap;
        let forgotCountMap;
        let lateForgivenSet;
        let earlyForgivenSet;
        let leavePeriodsMap;
        try {
          const rangeStart = moment
            .tz(dayRows[0].dateStr, "DD/MM/YYYY", TZ)
            .startOf("day")
            .toDate();
          const rangeEnd = moment
            .tz(dayRows[dayRows.length - 1].dateStr, "DD/MM/YYYY", TZ)
            .endOf("day")
            .toDate();

          const monthStart = moment.tz(rangeStart, TZ).startOf("month").toDate();
          const monthEnd = moment.tz(rangeEnd, TZ).endOf("month").toDate();

          const [worksheets, forgotReqs, lateReqs, earlyReqs, leaveStatuses] = await Promise.all([
            WorkSheetModel.find({
              user_id: userId,
              date: { $gte: rangeStart, $lte: rangeEnd },
              isDeleted: false
            }).populate("shifts"),
            RequestModel.find({
              user_id: userId,
              request_type: "forgot_checkin",
              status: "approved",
              isDeleted: false,
              date: { $gte: monthStart, $lte: monthEnd }
            }).sort({ date: 1 }),
            RequestModel.find({
              user_id: userId,
              request_type: "late_early",
              type: "late",
              status: "approved",
              isDeleted: false,
              date: { $gte: rangeStart, $lte: rangeEnd }
            }),
            RequestModel.find({
              user_id: userId,
              request_type: "late_early",
              type: "early_out",
              status: "approved",
              isDeleted: false,
              date: { $gte: rangeStart, $lte: rangeEnd }
            }),
            WorkDayStatusModel.find({
              user_id: userId,
              date: { $gte: rangeStart, $lte: rangeEnd },
              status: { $in: ["leave_paid", "leave_unpaid", "remote"] },
              isDeleted: false
            })
          ]);

          worksheetMap = new Map(
            worksheets.map((ws) => [moment.tz(ws.date, TZ).format("YYYY-MM-DD"), ws])
          );
          forgotMap = new Map(
            forgotReqs.map((r) => [moment.tz(r.date, TZ).format("YYYY-MM-DD"), r])
          );

          forgotCountMap = new Map();
          const monthlyCounter = new Map();
          for (const r of forgotReqs) {
            const m = moment.tz(r.date, TZ);
            const monthKey = m.format("YYYY-MM");
            const n = (monthlyCounter.get(monthKey) || 0) + 1;
            monthlyCounter.set(monthKey, n);
            forgotCountMap.set(m.format("YYYY-MM-DD"), n);
          }
          lateForgivenSet = new Set(
            lateReqs.map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD"))
          );
          earlyForgivenSet = new Set(
            earlyReqs.map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD"))
          );

          leavePeriodsMap = new Map();
          for (const ds of leaveStatuses) {
            const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
            if (!leavePeriodsMap.has(key)) leavePeriodsMap.set(key, new Set());
            leavePeriodsMap.get(key).add(ds.period);
          }
        } catch (e) {
          console.error(`[importExcel] Lỗi tải dữ liệu nhân viên (mã ${block.machine_code}):`, e);
          failures.push({
            machine_code: block.machine_code,
            date: null,
            reason: `Không tải được dữ liệu: ${e.message}`
          });
          skipped += dayRows.length;
          continue;
        }

        const excelDateKeys = new Set();

        for (const { dateStr, rawIn, rawOut } of dayRows) {
          const dateKey = moment.tz(dateStr, "DD/MM/YYYY", TZ).format("YYYY-MM-DD");

          if (rawIn || rawOut || forgotMap.has(dateKey)) {
            excelDateKeys.add(dateKey);
          }
          const worksheet = worksheetMap.get(dateKey);

          const computed = resolveAttendanceDay({
            dateKey,
            rawIn,
            rawOut,
            worksheet,
            forgotMap,
            forgotCountMap,
            lateForgivenSet,
            earlyForgivenSet,
            leavePeriodsMap,
            resolveLatePenalty,
            resolveEarlyPenalty,
            resolveForgotPenalty
          });
          if (computed.skip) {
            if (computed.unchanged) unchanged++;
            else skipped++;
            continue;
          }

          try {
            await saveAttendanceDay({ userId, dateKey, worksheet, computed });
            imported++;
          } catch (e) {
            console.error(`[importExcel] Lỗi ngày ${dateStr} (mã ${block.machine_code}):`, e);
            failures.push({
              machine_code: block.machine_code,
              date: dateStr,
              reason: e.message
            });
            skipped++;
          }
        }

        for (const [dateKey, worksheet] of worksheetMap) {
          if (excelDateKeys.has(dateKey)) continue;
          if (!worksheet.check_in && !worksheet.check_out) continue;
          const rawIn = worksheet.check_in
            ? moment.tz(worksheet.check_in, TZ).format("HH:mm")
            : null;
          const rawOut = worksheet.check_out
            ? moment.tz(worksheet.check_out, TZ).format("HH:mm")
            : null;

          const computed = resolveAttendanceDay({
            dateKey,
            rawIn,
            rawOut,
            worksheet,
            forgotMap,
            forgotCountMap,
            lateForgivenSet,
            earlyForgivenSet,
            leavePeriodsMap,
            resolveLatePenalty,
            resolveEarlyPenalty,
            resolveForgotPenalty
          });
          if (computed.skip) {
            if (computed.unchanged) unchanged++;
            else skipped++;
            continue;
          }

          try {
            await saveAttendanceDay({ userId, dateKey, worksheet, computed });
            imported++;
          } catch (e) {
            console.error(
              `[importExcel] Lỗi ngày ${dateKey} (mã ${block.machine_code}, dữ liệu app):`,
              e
            );
            failures.push({
              machine_code: block.machine_code,
              date: moment.tz(dateKey, TZ).format("DD/MM/YYYY"),
              reason: e.message
            });
            skipped++;
          }
        }
      }

      const unmatchedUniq = [...new Set(unmatched)];

      return res.json({
        message: `Import hoàn tất: ${imported} ngày cập nhật, ${unchanged} ngày không đổi, ${skipped} ngày bỏ qua`,
        data: {
          imported,
          unchanged,
          skipped,
          unmatched_codes: unmatchedUniq,
          failures
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getStandardWorkUnits: async (req, res) => {
    const TZ = "Asia/Ho_Chi_Minh";
    try {
      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);
      if (!month || !year || month < 1 || month > 12)
        return res.status(400).json({ message: "month và year là bắt buộc (month: 1-12)" });

      const refDate = moment.tz({ year, month: month - 1, day: 1 }, TZ);
      const periodStart = refDate.clone().subtract(1, "month").date(26).startOf("day");
      const periodEnd = refDate.clone().date(25).endOf("day");

      const { branch_id } = req.query;
      const holidays = await HolidayModel.find({
        date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
        isDeleted: false
      });

      const applicableHolidays = holidays.filter((h) => {
        if (h.scope_type === "all") return true;
        return branch_id && h.branches.some((b) => b.toString() === branch_id);
      });

      const holidayMap = new Map();
      for (const h of applicableHolidays) {
        const key = moment.tz(h.date, TZ).format("YYYY-MM-DD");
        holidayMap.set(key, h.duration_days ?? 1);
      }

      let weekdays = 0;
      let saturdays = 0;
      let holidayDeduction = 0;

      const cursor = periodStart.clone();
      while (cursor.isSameOrBefore(periodEnd, "day")) {
        const day = cursor.day();
        const key = cursor.format("YYYY-MM-DD");

        if (day === 0) {
          cursor.add(1, "day");
          continue;
        }

        if (holidayMap.has(key)) {
          holidayDeduction += day === 6 ? 0.5 : holidayMap.get(key);
        } else if (day === 6) {
          saturdays++;
        } else {
          weekdays++;
        }

        cursor.add(1, "day");
      }

      const standard_work_units = weekdays * 1 + saturdays * 0.5;

      return res.json({
        message: "OK",
        data: {
          period: {
            from: periodStart.format("DD/MM/YYYY"),
            to: periodEnd.format("DD/MM/YYYY")
          },
          standard_work_units,
          breakdown: {
            weekdays,
            saturdays,
            holiday_days: applicableHolidays.length,
            holiday_deduction: holidayDeduction
          }
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  adminEditWorksheet: async (req, res) => {
    try {
      const { worksheetId } = req.params;
      const { work_unit } = req.body;

      if (!mongoose.Types.ObjectId.isValid(worksheetId))
        return res.status(400).json({ message: "worksheetId không hợp lệ" });

      if (
        work_unit === undefined ||
        work_unit === null ||
        typeof work_unit !== "number" ||
        work_unit < 0
      )
        return res.status(400).json({ message: "work_unit phải là số không âm" });

      const worksheet = await WorkSheetModel.findOneAndUpdate(
        { _id: worksheetId, isDeleted: false },
        { work_unit, edited_by: req.account._id, edited_at: new Date() },
        { new: true }
      );
      if (!worksheet) return res.status(404).json({ message: "Không tìm thấy bản ghi công" });

      return res.status(200).json({
        message: "Cập nhật công thành công",
        data: worksheet
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = AttendanceController;
