const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const UserInfoModel = require("../models/UserInfoModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const HolidayModel = require("../models/HolidayModel");
const EmploymentStatusModel = require("../models/EmploymentStatusModel");
const WorkScheduleModel = require("../models/WorkScheduleModel");
const ShiftModel = require("../models/ShiftModel");
const { calcTotalDays, buildWorkDatesWithStatus } = require("./requestUtils");
const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");

const TZ = "Asia/Ho_Chi_Minh";
const RETROACTIVE_LIMIT_DAYS = 3;

function validate(body, userInfo) {
  const {
    from_date,
    from_period,
    to_date,
    to_period,
    leave_type,
  } = body;

  if (!from_date || !from_period || !to_date || !to_period || !leave_type)
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" },
    };
  if (!["paid", "unpaid"].includes(leave_type))
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" },
    };
  if (
    !["morning", "afternoon"].includes(from_period) ||
    !["morning", "afternoon"].includes(to_period)
  )
    return { error: { status: 400, message: "Buổi nghỉ không hợp lệ" } };

  const now = moment.tz(TZ);
  const today = now.clone().startOf("day");
  const fromMoment = moment.tz(from_date, TZ).startOf("day");

  if (fromMoment.isBefore(today.clone().subtract(RETROACTIVE_LIMIT_DAYS, "days")))
    return {
      error: {
        status: 400,
        message: `Chỉ được tạo đơn trong vòng ${RETROACTIVE_LIMIT_DAYS} ngày gần nhất`,
      },
    };

  if (fromMoment.isSame(today, "day")) {
    if (from_period === "morning" && now.isSameOrAfter(today.clone().hour(12)))
      return { error: { status: 400, message: "Không thể tạo đơn nghỉ cho buổi đã qua" } };
    if (from_period === "afternoon" && now.isSameOrAfter(today.clone().hour(13)))
      return { error: { status: 400, message: "Không thể tạo đơn nghỉ cho buổi đã qua" } };
  }

  const total_days = calcTotalDays(from_date, from_period, to_date, to_period);
  if (total_days === null || total_days === 0)
    return {
      error: { status: 400, message: "Khoảng thời gian nghỉ không hợp lệ" },
    };

  const balance = userInfo.leave_balance?.annual ?? 0;
  const monthDiff = fromMoment.diff(moment.tz(TZ).startOf("month"), "months");
  const projectedBalance = balance + monthDiff * MONTHLY_ACCRUAL;

  if (leave_type === "paid" && projectedBalance <= 0)
    return {
      error: { status: 400, message: "Bạn không còn ngày nghỉ phép có lương" },
    };

  const paid_days = leave_type === "paid" ? Math.min(total_days, Math.max(0, projectedBalance)) : 0;
  const unpaid_days = total_days - paid_days;

  return {
    payload: {
      from_date,
      from_period,
      to_date,
      to_period,
      total_days,
      leave_type,
      paid_days,
      unpaid_days,
    },
  };
}

function toSlot(date, period) {
  return `${moment.tz(date, TZ).format("YYYY-MM-DD")}_${period === "morning" ? "0" : "1"}`;
}

async function validateAsync(payload, userInfo, session) {
  if (payload.leave_type === "paid" && userInfo.employment_status) {
    const empStatus = await EmploymentStatusModel.findById(userInfo.employment_status);
    if (empStatus && !empStatus.can_use_annual_leave)
      return { status: 403, message: "Loại hợp đồng hiện tại chưa được sử dụng ngày phép có lương" };
  }

  const fromDate = moment.tz(payload.from_date, TZ).startOf("day").toDate();
  const toDate = moment.tz(payload.to_date, TZ).startOf("day").toDate();

  const candidates = await RequestModel.find({
    user_id: userInfo._id,
    request_type: "leave",
    status: { $in: ["pending", "approved"] },
    from_date: { $lte: toDate },
    to_date: { $gte: fromDate },
    isDeleted: false,
  }).session(session);

  const newFrom = toSlot(payload.from_date, payload.from_period);
  const newTo = toSlot(payload.to_date, payload.to_period);
  const overlap = candidates.find((r) => {
    return newFrom <= toSlot(r.to_date, r.to_period) && toSlot(r.from_date, r.from_period) <= newTo;
  });
  if (overlap)
    return { status: 409, message: "Đã có đơn nghỉ trong khoảng thời gian này" };

  const holidays = await HolidayModel.find({
    date: { $gte: fromDate, $lte: toDate },
    isDeleted: false,
  }).session(session);

  const userBranchId = userInfo.branch_id?.toString();
  const applicableHolidays = holidays.filter((h) => {
    if (h.scope_type === "all") return true;
    return userBranchId && h.branches.some((b) => b.toString() === userBranchId);
  });

  const workingHolidays = applicableHolidays.filter((h) => moment.tz(h.date, TZ).day() !== 0);
  if (workingHolidays.length) {
    const names = workingHolidays.map((h) => h.name).join(", ");
    return {
      status: 400,
      message: `Khoảng thời gian nghỉ chứa ngày lễ: ${names}. Vui lòng tách đơn.`,
    };
  }

  return null;
}

async function onCreate(request, userInfo, session) {
  if (request.paid_days > 0) {
    await UserInfoModel.findByIdAndUpdate(
      userInfo._id,
      { $inc: { "leave_balance.annual": -request.paid_days } },
      { session },
    );
  }
  return null;
}

async function resolveShiftsForDates(userId, dates, session) {
  const userInfo = await UserInfoModel.findById(userId, {
    employment_type: 1,
  }).session(session);
  const isParttime = userInfo?.employment_type === "parttime";

  const dated = dates.map(({ date }) => {
    const m = moment.tz(date, TZ);
    return { key: m.format("YYYY-MM-DD"), dayOfWeek: m.day() === 0 ? 7 : m.day() };
  });

  const map = new Map();

  if (isParttime) {
    const schedules = await WorkScheduleModel.find({ userId }).session(session);
    const byDow = new Map();
    for (const s of schedules) {
      const arr = byDow.get(s.dayOfWeek) || [];
      arr.push(...s.shifts);
      byDow.set(s.dayOfWeek, arr);
    }
    for (const { key, dayOfWeek } of dated) {
      map.set(key, byDow.get(dayOfWeek) || []);
    }
  } else {
    const [adminShift, morningShift] = await Promise.all([
      ShiftModel.findOne({ name: "Ca hành chính" }).session(session),
      ShiftModel.findOne({ name: "Ca sáng" }).session(session),
    ]);
    for (const { key, dayOfWeek } of dated) {
      const shift = dayOfWeek === 6 ? morningShift : adminShift;
      map.set(key, shift ? [shift._id] : []);
    }
  }

  return map;
}

async function onApprove(request, session) {
  const fromMoment = moment.tz(request.from_date, TZ).startOf("day");
  const toMoment = moment.tz(request.to_date, TZ).startOf("day");
  const fromStart = fromMoment.toDate();
  const toEnd = moment.tz(request.to_date, TZ).endOf("day").toDate();

  const datesWithStatus = buildWorkDatesWithStatus(request, fromMoment, toMoment);

  const existing = await WorkSheetModel.find(
    { user_id: request.user_id, date: { $gte: fromStart, $lte: toEnd }, isDeleted: false },
    { date: 1 },
  ).session(session);
  const sheetMap = new Map(
    existing.map((w) => [moment.tz(w.date, TZ).format("YYYY-MM-DD"), w._id]),
  );

  const missing = datesWithStatus.filter(
    (d) => !sheetMap.has(moment.tz(d.date, TZ).format("YYYY-MM-DD")),
  );
  if (missing.length) {
    const shiftMap = await resolveShiftsForDates(request.user_id, missing, session);
    const created = await WorkSheetModel.insertMany(
      missing.map(({ date }) => ({
        user_id: request.user_id,
        date,
        shifts: shiftMap.get(moment.tz(date, TZ).format("YYYY-MM-DD")) || [],
      })),
      { session },
    );
    created.forEach((w) => sheetMap.set(moment.tz(w.date, TZ).format("YYYY-MM-DD"), w._id));
  }

  for (const { date, status, period } of datesWithStatus) {
    const worksheet_id = sheetMap.get(moment.tz(date, TZ).format("YYYY-MM-DD"));
    await WorkDayStatusModel.findOneAndUpdate(
      { user_id: request.user_id, date, period },
      {
        worksheet_id,
        status,
        $addToSet: { sources: { ref_id: request._id, ref_type: "request" } },
      },
      { upsert: true, session, new: true },
    );
  }
}

async function onReject(request, session) {
  if (request.paid_days > 0) {
    await UserInfoModel.findByIdAndUpdate(
      request.user_id,
      { $inc: { "leave_balance.annual": request.paid_days } },
      { session },
    );
  }
}

async function resolveLeaveConflictOnAttendance({
  userId,
  worksheetId,
  date,
  checkInTime,
  checkOutTime,
  lastShiftEnd,
  session,
}) {
  const dateStart = moment.tz(date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(date, TZ).endOf("day").toDate();

  const leaveStatuses = await WorkDayStatusModel.find({
    user_id: userId,
    date: { $gte: dateStart, $lte: dateEnd },
    status: { $in: ["leave_paid", "leave_unpaid"] },
    isDeleted: false,
  }).session(session);

  if (!leaveStatuses.length) return;

  const noon = moment.tz(date, TZ).hour(12).minute(0).second(0);
  const checkIn = checkInTime ? moment.tz(checkInTime, TZ) : null;
  const checkOut = checkOutTime ? moment.tz(checkOutTime, TZ) : null;

  const coversMorning = !!checkIn && checkIn.isBefore(noon);

  let coversAfternoon = false;
  if (checkOut && lastShiftEnd) {
    const [endH, endM] = lastShiftEnd.split(":").map(Number);
    const shiftEndMoment = moment.tz(date, TZ).hour(endH).minute(endM).second(0);
    const threshold = shiftEndMoment.clone().subtract(60, "minutes");
    coversAfternoon = checkOut.isSameOrAfter(threshold);
  }

  let totalRefund = 0;

  for (const ls of leaveStatuses) {
    const shouldOverride =
      (ls.period === "morning" && coversMorning) ||
      (ls.period === "afternoon" && coversAfternoon) ||
      (ls.period === "full" && coversMorning && coversAfternoon);

    if (!shouldOverride) continue;

    await WorkDayStatusModel.findByIdAndUpdate(
      ls._id,
      {
        status: "present",
        worksheet_id: worksheetId,
        $addToSet: { sources: { ref_id: worksheetId, ref_type: "attendance" } },
      },
      { session },
    );

    if (ls.status === "leave_paid") {
      const isSaturday = moment.tz(ls.date, TZ).day() === 6;
      totalRefund += ls.period === "full" && !isSaturday ? 1 : 0.5;
    }
  }

  if (totalRefund > 0) {
    await UserInfoModel.findByIdAndUpdate(
      userId,
      { $inc: { "leave_balance.annual": totalRefund } },
      { session },
    );
  }
}

module.exports = { validate, validateAsync, onCreate, onApprove, onReject, resolveLeaveConflictOnAttendance };
