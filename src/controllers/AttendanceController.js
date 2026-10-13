const { default: mongoose } = require("mongoose");
const moment = require("moment-timezone");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const HolidayModel = require("../models/HolidayModel");
const DepartmentModel = require("../models/DepartmentModel");
const AttendanceMachineMappingModel = require("../models/AttendanceMachineMappingModel");
const { RequestModel } = require("../models/RequestModel");
const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");
const { getLeaveBalance, adjustLeaveBalance } = require("../modules/leave");
const { LEAVE_BALANCE_REASON } = require("../constants");
const {
  processAttendanceDay,
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver,
  buildHolidayDefaultWorkUnitMap
} = require("../modules/timesheet");
const {
  listAllowedWifiLocations,
  createAllowedWifiLocation,
  deleteAllowedWifiLocation,
  listShifts,
  createShift,
  parseExcelToBlocks,
  parseDayRows
} = require("../modules/attendance");
const { recordCheckIn } = require("../workflows/record-check-in.workflow");
const { recordCheckOut } = require("../workflows/record-check-out.workflow");
const { buildAttendanceContext } = require("../workflows/import-attendance.workflow");
const { toMongoQuery } = require("../modules/permission");
const { correctDayStatuses } = require("../helpers/attendanceHelper");
const { getPayrollPeriodRange, calcStandardWorkUnits } = require("../helpers/payrollPeriod");
const { sendExceptionResponse } = require("../core/http/handle-exception");
const { mapWithConcurrency } = require("../core/async/map-with-concurrency");
const { buildPayrollRows, getPayrollPeriodByMonth } = require("../helpers/payrollStats");
const { buildTimesheetWorkbook, isFixedCtv } = require("../helpers/timesheetExcel");
const { stillEmployedAtFilter } = require("../shared-kernel/resignation");

const IMPORT_EXCEL_DAY_CONCURRENCY = 10;

const PAYROLL_USER_FIELDS =
  "ma_nv full_name probation_end_date resignation_date employment_type branch_id";

// Nhân sự nghỉ việc TRONG kỳ (ngày làm cuối nằm trong kỳ) nhưng không có công nào → không đưa vào
// bảng công. CTV (chức vụ "CTV") giữ lại vì tính công cố định, không dựa trên chấm công.
async function findResignedWithoutWorkIds(baseFilter, periodStart, periodEnd) {
  const candidates = await UserInfoModel.find(
    {
      $and: [
        baseFilter,
        { resignation_date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() } }
      ]
    },
    PAYROLL_USER_FIELDS
  );
  if (!candidates.length) return [];

  const [{ rows }, memberships] = await Promise.all([
    buildPayrollRows({ users: candidates, periodStart, periodEnd }),
    UserDepartmentPositionModel.find({
      user: { $in: candidates.map((u) => u._id) },
      isDeleted: false
    })
      .populate("position", "position_name")
      .lean()
  ]);
  const positionsByUser = new Map();
  for (const m of memberships) {
    const key = m.user.toString();
    if (!positionsByUser.has(key)) positionsByUser.set(key, []);
    positionsByUser.get(key).push(m.position?.position_name);
  }

  return rows
    .filter(
      (row) =>
        row.work_unit_total <= 0 && !isFixedCtv(positionsByUser.get(row.user_id.toString()) || [])
    )
    .map((row) => row.user_id);
}

// Điều kiện lọc nhân viên cho bảng công của 1 kỳ: phạm vi quyền payroll.view + phòng ban + từ khoá
// (tên/mã NV) + trạng thái nghỉ việc — bỏ người có ngày làm cuối trước kỳ, và người nghỉ trong kỳ mà
// không có công nào.
async function buildPayrollUserFilter(
  permissionAbility,
  { department, q, periodStart, periodEnd }
) {
  const userFilter = { isDeleted: false };
  const scopeConditions = [];
  const scopeFilter = toMongoQuery(permissionAbility, "payroll.view", "Payroll");
  if (Object.keys(scopeFilter).length > 0) scopeConditions.push(scopeFilter);

  if (department && mongoose.Types.ObjectId.isValid(department)) {
    const deptUserIds = await UserDepartmentPositionModel.distinct("user", {
      department
    });
    scopeConditions.push({ _id: { $in: deptUserIds } });
  }

  scopeConditions.push(stillEmployedAtFilter(periodStart.toDate()));

  if (q && q.trim()) {
    const kw = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    scopeConditions.push({
      $or: [{ full_name: { $regex: kw, $options: "i" } }, { ma_nv: { $regex: kw, $options: "i" } }]
    });
  }

  userFilter.$and = scopeConditions;

  const excludedIds = await findResignedWithoutWorkIds(userFilter, periodStart, periodEnd);
  if (excludedIds.length) userFilter.$and.push({ _id: { $nin: excludedIds } });

  return userFilter;
}

const AttendanceController = {
  getAllowedWifiLocations: async (req, res) => {
    try {
      const docs = await listAllowedWifiLocations();
      res.json({
        message: "Lấy danh sách điểm chấm công thành công",
        data: docs
      });
    } catch (error) {
      sendExceptionResponse(res, error);
    }
  },

  createAllowedWifiLocation: async (req, res) => {
    try {
      const doc = await createAllowedWifiLocation(req.body);
      res.json({ message: "Tạo điểm chấm công thành công", data: doc });
    } catch (error) {
      sendExceptionResponse(res, error);
    }
  },

  deleteAllowedWifiLocation: async (req, res) => {
    try {
      const { id } = req.params;
      await deleteAllowedWifiLocation(id);
      res.json({ message: "Xóa điểm chấm công thành công" });
    } catch (error) {
      sendExceptionResponse(res, error);
    }
  },

  createShift: async (req, res) => {
    try {
      const shift = await createShift(req.body);
      return res.status(201).json({ message: "Tạo ca làm việc thành công", data: shift });
    } catch (err) {
      return sendExceptionResponse(res, err);
    }
  },

  checkIn: async (req, res) => {
    try {
      const { ssid, latitude, longitude } = req.body;
      const result = await recordCheckIn({ account: req.account, ssid, latitude, longitude });
      return res.json({
        message: "Check-in thành công",
        check_in: result.checkIn,
        minutes_late: result.minutesLate
      });
    } catch (err) {
      return sendExceptionResponse(res, err);
    }
  },

  checkOut: async (req, res) => {
    try {
      const { ssid, latitude, longitude } = req.body;
      const result = await recordCheckOut({ account: req.account, ssid, latitude, longitude });
      return res.json({
        message: "Check-out thành công",
        check_out: result.checkOut,
        minute_early: result.minuteEarly
      });
    } catch (err) {
      return sendExceptionResponse(res, err);
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

      const scopeConditions = [];
      const scopeFilter = toMongoQuery(req.permissionAbility, "attendance.view", "Attendance");
      if (Object.keys(scopeFilter).length > 0) scopeConditions.push(scopeFilter);

      if (req.query.department && mongoose.Types.ObjectId.isValid(req.query.department)) {
        const deptUserIds = await UserDepartmentPositionModel.distinct("user", {
          department: req.query.department
        });
        scopeConditions.push({ user_id: { $in: deptUserIds } });
      }

      const baseQuery = {
        date: { $gte: targetDate, $lt: nextDate },
        ...(scopeConditions.length > 0 ? { $and: scopeConditions } : {})
      };

      const [worksheets, statuses] = await Promise.all([
        WorkSheetModel.find(baseQuery)
          .populate("user_id", "full_name ma_nv employment_type")
          .populate("shifts", "name start_time end_time")
          .sort({ createdAt: 1 }),
        WorkDayStatusModel.find({ ...baseQuery, isDeleted: false })
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
      const shifts = await listShifts();
      return res.status(200).json({
        message: "Lấy danh sách ca làm việc thành công",
        data: shifts
      });
    } catch (error) {
      return sendExceptionResponse(res, error);
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

      const isSelf = userInfo.id_account?.toString() === req.account._id.toString();

      if (!isSelf) {
        const scopeFilter = toMongoQuery(req.permissionAbility, "payroll.view", "Payroll");
        const allowed = await UserInfoModel.exists({ $and: [{ _id: userInfo._id }, scopeFilter] });
        if (!allowed) {
          return res.status(403).json({ message: "Bạn không có quyền xem nhân viên này" });
        }
      }

      const [worksheets, dayStatuses, holidays, requests, forgotRequests] = await Promise.all([
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
        HolidayModel.find({
          date: { $gte: periodStart.toDate(), $lte: periodEnd.toDate() },
          isDeleted: false
        }),
        RequestModel.find({
          user_id: userInfo._id,
          isDeleted: false,
          status: { $in: ["pending", "approved"] },
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

      // Gap SRS: ngày lễ (paid) mặc định hiển thị 1 công dù không ai chấm công ngày đó — chỉ điền vào
      // ngày CHƯA có worksheet nào (không ghi đè work_unit đã tính từ luồng khác).
      const holidayDefaultMap = buildHolidayDefaultWorkUnitMap(
        holidays.map((h) => ({
          date: h.date,
          pay_policy: h.pay_policy,
          scope_type: h.scope_type,
          branches: (h.branches || []).map((b) => b.toString())
        })),
        userInfo.branch_id?.toString()
      );

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
        ...forgotReqMap.keys(),
        ...holidayDefaultMap.keys()
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
        const statuses = correctDayStatuses(dsMap.get(dateStr) || [], ws);
        const reqs = reqMap.get(dateStr) || [];

        const holidayDefaultWorkUnit = holidayDefaultMap.get(dateStr);
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
        } else if (holidayDefaultWorkUnit) {
          work_unit_total += holidayDefaultWorkUnit;
          const isProbation = probationEnd && moment.tz(dateStr, TZ).isBefore(probationEnd, "day");
          if (isProbation) work_unit_probation += holidayDefaultWorkUnit;
          else work_unit_official += holidayDefaultWorkUnit;
        }
        for (const s of statuses) {
          const w = s.period === "full" ? 1 : 0.5;
          if (s.status === "present") present_days += w;
          else if (s.status === "missed_clock") missed_clock_days += 1;
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
          work_unit: ws?.work_unit ?? holidayDefaultWorkUnit ?? null,
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
              status: r.status,
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
          standard_work_units: calcStandardWorkUnits({
            periodStart,
            periodEnd,
            holidays,
            branchId: userInfo.branch_id
          }).standard_work_units,
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

  getMyPayrollStats: async (req, res) => {
    try {
      const myInfo = await UserInfoModel.findOne({
        id_account: req.account._id,
        isDeleted: false
      });
      if (!myInfo) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      req.params.userId = myInfo._id.toString();
      return AttendanceController.getPayrollStats(req, res);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  getPayrollStatsAll: async (req, res) => {
    try {
      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);
      if (!month || !year || month < 1 || month > 12)
        return res.status(400).json({ message: "month và year là bắt buộc (month: 1-12)" });

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
      const { department, q } = req.query;

      const { periodStart, periodEnd } = getPayrollPeriodByMonth(month, year);
      const userFilter = await buildPayrollUserFilter(req.permissionAbility, {
        department,
        q,
        periodStart,
        periodEnd
      });

      const totalUsers = await UserInfoModel.countDocuments(userFilter);
      const users = await UserInfoModel.find(userFilter, PAYROLL_USER_FIELDS)
        .sort({ ma_nv: 1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const { rows: data } = await buildPayrollRows({ users, periodStart, periodEnd });

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

  // GET /attendance/payroll-stats-all/export?month=&year=&department=&q=
  // Xuất Excel "Bảng chấm công" theo mẫu sheet Tổng công của HR: ký hiệu từng ngày (X, V, H, P, K,
  // R, A, L) + tổng công. Không phân trang — lấy toàn bộ nhân viên trong phạm vi quyền payroll.view.
  exportPayrollTimesheet: async (req, res) => {
    try {
      const month = parseInt(req.query.month, 10);
      const year = parseInt(req.query.year, 10);
      if (!month || !year || month < 1 || month > 12)
        return res.status(400).json({ message: "month và year là bắt buộc (month: 1-12)" });
      const { department, q } = req.query;

      const { periodStart, periodEnd } = getPayrollPeriodByMonth(month, year);
      const userFilter = await buildPayrollUserFilter(req.permissionAbility, {
        department,
        q,
        periodStart,
        periodEnd
      });
      const users = await UserInfoModel.find(userFilter, PAYROLL_USER_FIELDS).sort({ ma_nv: 1 });

      const [{ rows, holidays }, memberships, departmentDoc] = await Promise.all([
        buildPayrollRows({ users, periodStart, periodEnd, includeDaily: true }),
        UserDepartmentPositionModel.find({
          user: { $in: users.map((u) => u._id) },
          isDeleted: false
        })
          .populate("department", "department_name")
          .populate("position", "position_name")
          .sort({ createdAt: 1 })
          .lean(),
        department && mongoose.Types.ObjectId.isValid(department)
          ? DepartmentModel.findById(department, "department_name").lean()
          : null
      ]);

      const membershipsByUser = new Map();
      for (const m of memberships) {
        const key = m.user.toString();
        if (!membershipsByUser.has(key)) membershipsByUser.set(key, []);
        membershipsByUser.get(key).push(m);
      }
      const uniqueNames = (items) => [...new Set(items.filter(Boolean))];

      const employees = rows
        .map((row) => {
          const userMemberships = membershipsByUser.get(row.user_id.toString()) || [];
          return {
            row,
            departmentNames: uniqueNames(userMemberships.map((m) => m.department?.department_name)),
            positionNames: uniqueNames(userMemberships.map((m) => m.position?.position_name))
          };
        })
        // Gom theo đơn vị như file HR; nhân viên chưa có phòng ban xếp cuối
        .sort((a, b) => {
          const deptA = a.departmentNames[0] || "￿";
          const deptB = b.departmentNames[0] || "￿";
          return (
            deptA.localeCompare(deptB, "vi") ||
            String(a.row.ma_nv || "").localeCompare(String(b.row.ma_nv || ""))
          );
        });

      const workbook = buildTimesheetWorkbook({
        month,
        year,
        periodStart,
        periodEnd,
        standardWorkUnits: calcStandardWorkUnits({ periodStart, periodEnd, holidays })
          .standard_work_units,
        departmentName: departmentDoc?.department_name ?? "",
        employees
      });
      const buffer = await workbook.xlsx.writeBuffer();

      const label = `T${String(month).padStart(2, "0")}-${year}`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bang-cong-${label}.xlsx"; filename*=UTF-8''${encodeURIComponent(
          `Bảng công ${label}.xlsx`
        )}`
      );
      return res.send(Buffer.from(buffer));
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

      const [holidays, dayStatuses, worksheets] = await Promise.all([
        HolidayModel.find(
          {
            date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
            isDeleted: false
          },
          "date name"
        ),
        // Không lọc theo status nữa — 1 ngày có thể cần hiện nhiều badge cùng lúc (vd quên chấm công
        // buổi sáng + đi làm bình thường buổi chiều), FE tự quyết định badge nào ưu tiên hiển thị.
        WorkDayStatusModel.find(
          {
            user_id: user._id,
            date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
            isDeleted: false
          },
          "date period status"
        ),
        // minutes_late/minute_early sống trên WorkSheet, độc lập với WorkDayStatus.status — 1 ngày có
        // thể vừa "present" vừa đi muộn/về sớm, FE cần cả 2 để ghép badge (xem yêu cầu nghiệp vụ: 1
        // ngày có thể trả nhiều trạng thái cùng lúc).
        WorkSheetModel.find(
          {
            user_id: user._id,
            date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
            isDeleted: false
          },
          "date minutes_late minute_early"
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
          })),
          late_early: worksheets
            .filter((w) => w.minutes_late > 0 || w.minute_early > 0)
            .map((w) => ({
              date: moment.tz(w.date, "Asia/Ho_Chi_Minh").format("YYYY-MM-DD"),
              minutes_late: w.minutes_late,
              minute_early: w.minute_early
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
    const importStartedAt = Date.now();
    const elapsed = (from) => `${Date.now() - from}ms`;
    try {
      if (!req.file) return res.status(400).json({ message: "Chưa upload file" });

      let blocks;
      const parseStartedAt = Date.now();
      try {
        blocks = parseExcelToBlocks(req.file.buffer);
      } catch (e) {
        console.error("[importExcel] Lỗi đọc file:", e);
        return res.status(400).json({
          message: "Không đọc được file Excel. Kiểm tra lại định dạng file (.xlsx)."
        });
      }
      console.log(
        `[importExcel][timing] parse file: ${elapsed(parseStartedAt)}, ${blocks.length} block(s), file size ${req.file.size} bytes`
      );
      if (!blocks.length)
        return res.status(400).json({
          message: "File không đúng định dạng bảng chấm công (không tìm thấy nhân viên nào)."
        });

      const mappingStartedAt = Date.now();
      const allMappings = await AttendanceMachineMappingModel.find({
        isDeleted: false
      });
      console.log(`[importExcel][timing] load mapping: ${elapsed(mappingStartedAt)}`);
      if (!allMappings.length)
        return res.status(400).json({
          message:
            "Chưa cấu hình mapping mã máy chấm công với nhân viên. Vui lòng tạo mapping trước khi import."
        });
      const mappingMap = new Map(allMappings.map((m) => [m.machine_code, m.user_id]));

      const resolverStartedAt = Date.now();
      const resolveLatePenalty = await buildLatePenaltyResolver();
      const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
      const resolveForgotPenalty = await buildForgotPenaltyResolver();
      console.log(`[importExcel][timing] build penalty resolvers: ${elapsed(resolverStartedAt)}`);

      const unmatched = [];
      const failures = [];
      const counts = { imported: 0, skipped: 0, unchanged: 0 };
      let blockIndex = 0;

      for (const block of blocks) {
        blockIndex += 1;
        const blockStartedAt = Date.now();
        const userId = mappingMap.get(block.machine_code);
        if (!userId) {
          unmatched.push(block.machine_code);
          continue;
        }

        const dayRows = parseDayRows(block);
        if (!dayRows.length) continue;

        let worksheetMap;
        let forgotMap;
        let forgotOccurrenceMap;
        let lateForgivenSet;
        let earlyForgivenSet;
        let leavePeriodsMap;
        const contextStartedAt = Date.now();
        try {
          const rangeStart = moment
            .tz(dayRows[0].dateStr, "DD/MM/YYYY", TZ)
            .startOf("day")
            .toDate();
          const rangeEnd = moment
            .tz(dayRows[dayRows.length - 1].dateStr, "DD/MM/YYYY", TZ)
            .endOf("day")
            .toDate();

          const periodStart = getPayrollPeriodRange(rangeStart).start;
          const periodEnd = getPayrollPeriodRange(rangeEnd).end;

          const excelRawByDate = new Map(
            dayRows.map(({ dateStr, rawIn, rawOut }) => [
              moment.tz(dateStr, "DD/MM/YYYY", TZ).format("YYYY-MM-DD"),
              { rawIn, rawOut }
            ])
          );

          const [worksheets, context] = await Promise.all([
            WorkSheetModel.find({
              user_id: userId,
              date: { $gte: rangeStart, $lte: rangeEnd },
              isDeleted: false
            }).populate("shifts"),
            buildAttendanceContext({
              userId: userId.toString(),
              rangeStart,
              rangeEnd,
              periodStart,
              periodEnd,
              excelRawByDate
            })
          ]);

          worksheetMap = new Map(
            worksheets.map((ws) => [moment.tz(ws.date, TZ).format("YYYY-MM-DD"), ws])
          );
          ({ forgotMap, forgotOccurrenceMap, lateForgivenSet, earlyForgivenSet, leavePeriodsMap } =
            context);
          console.log(
            `[importExcel][timing] block ${blockIndex}/${blocks.length} (mã ${block.machine_code}, ${dayRows.length} ngày) - load context: ${elapsed(contextStartedAt)}`
          );
        } catch (e) {
          console.error(`[importExcel] Lỗi tải dữ liệu nhân viên (mã ${block.machine_code}):`, e);
          failures.push({
            machine_code: block.machine_code,
            date: null,
            reason: `Không tải được dữ liệu: ${e.message}`
          });
          counts.skipped += dayRows.length;
          continue;
        }

        const excelDateKeys = new Set();
        const excelLoopStartedAt = Date.now();

        await mapWithConcurrency(
          dayRows,
          IMPORT_EXCEL_DAY_CONCURRENCY,
          async ({ dateStr, rawIn, rawOut }) => {
            const dateKey = moment.tz(dateStr, "DD/MM/YYYY", TZ).format("YYYY-MM-DD");

            if (rawIn || rawOut || forgotMap.has(dateKey)) {
              excelDateKeys.add(dateKey);
            }
            const worksheet = worksheetMap.get(dateKey);
            if (!worksheet) {
              counts.skipped++;
              return;
            }

            try {
              const result = await processAttendanceDay({
                userId,
                worksheetId: worksheet._id.toString(),
                dateKey,
                rawIn,
                rawOut,
                worksheet,
                forgotMap,
                forgotOccurrenceMap,
                lateForgivenSet,
                earlyForgivenSet,
                leavePeriodsMap,
                resolveLatePenalty,
                resolveEarlyPenalty,
                resolveForgotPenalty
              });
              if (result.skip) {
                counts.skipped++;
              } else if (result.unchanged) {
                counts.unchanged++;
              } else {
                counts.imported++;
              }
              if (result.leaveRefundAmount > 0) {
                await adjustLeaveBalance({
                  userId,
                  amount: result.leaveRefundAmount,
                  reason: LEAVE_BALANCE_REASON.ATTENDANCE_OVERRIDE_REFUND,
                  refId: worksheet._id,
                  refType: "system",
                  allowNegative: true
                });
              }
            } catch (e) {
              console.error(`[importExcel] Lỗi ngày ${dateStr} (mã ${block.machine_code}):`, e);
              failures.push({
                machine_code: block.machine_code,
                date: dateStr,
                reason: e.message
              });
              counts.skipped++;
            }
          }
        );

        console.log(
          `[importExcel][timing] block ${blockIndex}/${blocks.length} (mã ${block.machine_code}) - process ${dayRows.length} ngày (excel): ${elapsed(excelLoopStartedAt)}`
        );

        const catchupLoopStartedAt = Date.now();
        const catchupEntries = [...worksheetMap.entries()].filter(
          ([dateKey, worksheet]) =>
            !excelDateKeys.has(dateKey) && (worksheet.check_in || worksheet.check_out)
        );

        await mapWithConcurrency(
          catchupEntries,
          IMPORT_EXCEL_DAY_CONCURRENCY,
          async ([dateKey, worksheet]) => {
            const rawIn = worksheet.check_in
              ? moment.tz(worksheet.check_in, TZ).format("HH:mm")
              : null;
            const rawOut = worksheet.check_out
              ? moment.tz(worksheet.check_out, TZ).format("HH:mm")
              : null;

            try {
              const result = await processAttendanceDay({
                userId,
                worksheetId: worksheet._id.toString(),
                dateKey,
                rawIn,
                rawOut,
                worksheet,
                forgotMap,
                forgotOccurrenceMap,
                lateForgivenSet,
                earlyForgivenSet,
                leavePeriodsMap,
                resolveLatePenalty,
                resolveEarlyPenalty,
                resolveForgotPenalty
              });
              if (result.skip) {
                counts.skipped++;
              } else if (result.unchanged) {
                counts.unchanged++;
              } else {
                counts.imported++;
              }
              if (result.leaveRefundAmount > 0) {
                await adjustLeaveBalance({
                  userId,
                  amount: result.leaveRefundAmount,
                  reason: LEAVE_BALANCE_REASON.ATTENDANCE_OVERRIDE_REFUND,
                  refId: worksheet._id,
                  refType: "system",
                  allowNegative: true
                });
              }
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
              counts.skipped++;
            }
          }
        );

        const catchupCount = catchupEntries.length;

        console.log(
          `[importExcel][timing] block ${blockIndex}/${blocks.length} (mã ${block.machine_code}) - process ${catchupCount} ngày (dữ liệu app, ngoài excel): ${elapsed(catchupLoopStartedAt)}, tổng block: ${elapsed(blockStartedAt)}`
        );
      }

      console.log(
        `[importExcel][timing] TỔNG THỜI GIAN: ${elapsed(importStartedAt)} (${counts.imported} ngày cập nhật, ${counts.unchanged} không đổi, ${counts.skipped} bỏ qua, ${blocks.length} block)`
      );

      const unmatchedUniq = [...new Set(unmatched)];

      return res.json({
        message: `Import hoàn tất: ${counts.imported} ngày cập nhật, ${counts.unchanged} ngày không đổi, ${counts.skipped} ngày bỏ qua`,
        data: {
          imported: counts.imported,
          unchanged: counts.unchanged,
          skipped: counts.skipped,
          unmatched_codes: unmatchedUniq,
          failures
        }
      });
    } catch (err) {
      console.error(`[importExcel][timing] LỖI sau ${elapsed(importStartedAt)}:`, err);
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

      const { standard_work_units, weekdays, saturdays, holiday_count, holiday_deduction } =
        calcStandardWorkUnits({
          periodStart,
          periodEnd,
          holidays,
          branchId: branch_id
        });

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
            holiday_days: holiday_count,
            holiday_deduction
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
      const { work_unit, penalty_amount } = req.body;

      if (!mongoose.Types.ObjectId.isValid(worksheetId))
        return res.status(400).json({ message: "worksheetId không hợp lệ" });

      const hasWorkUnit = work_unit !== undefined;
      const hasPenalty = penalty_amount !== undefined;

      if (!hasWorkUnit && !hasPenalty)
        return res.status(400).json({ message: "Cần truyền work_unit hoặc penalty_amount" });

      if (hasWorkUnit && (typeof work_unit !== "number" || work_unit < 0))
        return res.status(400).json({ message: "work_unit phải là số không âm" });

      if (hasPenalty && (typeof penalty_amount !== "number" || penalty_amount < 0))
        return res.status(400).json({ message: "penalty_amount phải là số không âm" });

      const updateData = { edited_by: req.account._id, edited_at: new Date() };
      if (hasWorkUnit) updateData.work_unit = work_unit;
      if (hasPenalty) updateData.penalty_amount = penalty_amount;

      const worksheet = await WorkSheetModel.findOneAndUpdate(
        { _id: worksheetId, isDeleted: false },
        updateData,
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
