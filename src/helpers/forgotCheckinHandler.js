const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const { normalizeDayPunches } = require("./attendanceHelper");
const { buildUnifiedForgotOccurrenceMap } = require("../modules/timesheet");
const { getPayrollPeriodRange } = require("./payrollPeriod");

const TZ = "Asia/Ho_Chi_Minh";

function validate(body) {
  const { date, type, expected_check_in, expected_check_out } = body;

  if (!date || !type) return { error: { status: 400, message: "Thông tin đầu vào không hợp lệ" } };
  if (!["check_in", "check_out", "both"].includes(type))
    return { error: { status: 400, message: "Loại không hợp lệ" } };

  const dateMoment = moment.tz(date, TZ);

  const needsCheckIn = type === "check_in" || type === "both";
  const needsCheckOut = type === "check_out" || type === "both";

  if (needsCheckIn && !expected_check_in)
    return { error: { status: 400, message: "Vui lòng nhập giờ check-in dự kiến" } };
  if (needsCheckOut && !expected_check_out)
    return { error: { status: 400, message: "Vui lòng nhập giờ check-out dự kiến" } };

  const dayStart = dateMoment.clone().startOf("day");
  const dayEnd = dateMoment.clone().endOf("day");

  if (needsCheckIn) {
    const cin = moment.tz(expected_check_in, TZ);
    if (!cin.isBetween(dayStart, dayEnd, null, "[]"))
      return { error: { status: 400, message: "Giờ check-in dự kiến không hợp lệ" } };
  }
  if (needsCheckOut) {
    const cout = moment.tz(expected_check_out, TZ);
    if (!cout.isBetween(dayStart, dayEnd, null, "[]"))
      return { error: { status: 400, message: "Giờ check-out dự kiến không hợp lệ" } };
  }
  if (needsCheckIn && needsCheckOut) {
    if (moment.tz(expected_check_in, TZ).isSameOrAfter(moment.tz(expected_check_out, TZ)))
      return { error: { status: 400, message: "Giờ check-in phải trước giờ check-out" } };
  }

  return {
    payload: {
      date,
      type,
      expected_check_in: needsCheckIn ? new Date(expected_check_in) : null,
      expected_check_out: needsCheckOut ? new Date(expected_check_out) : null
    }
  };
}

async function validateAsync(payload, userInfo, session) {
  const dup = await RequestModel.findOne({
    user_id: userInfo._id,
    request_type: "forgot_checkin",
    status: { $in: ["pending", "approved"] },
    date: new Date(payload.date),
    isDeleted: false
  }).session(session);
  if (dup) return { status: 409, message: "Đã có đơn quên chấm công cho ngày này" };

  // Tính occurrence TRƯỚC khi tạo đơn — trả về để service merge vào entity lúc tạo,
  // không tự ghi DB ở đây (đơn chưa tồn tại nên computeForgotOccurrence không cần biết
  // gì về đơn đang tạo, chỉ đếm đơn "approved" đã có sẵn).
  const occurrence = await computeForgotOccurrence(userInfo._id, payload.date, session);
  return { occurrence };
}

async function computeForgotOccurrence(userId, date, session) {
  const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(date);

  const [monthRequests, monthWorksheets, monthLeaveStatuses] = await Promise.all([
    RequestModel.find({
      user_id: userId,
      request_type: "forgot_checkin",
      status: "approved",
      isDeleted: false,
      date: { $gte: periodStart, $lte: periodEnd }
    })
      .sort({ date: 1 })
      .session(session),
    WorkSheetModel.find({
      user_id: userId,
      date: { $gte: periodStart, $lte: periodEnd },
      isDeleted: false
    }).session(session),
    WorkDayStatusModel.find({
      user_id: userId,
      date: { $gte: periodStart, $lte: periodEnd },
      status: { $in: ["leave_paid", "leave_unpaid", "remote"] },
      isDeleted: false
    }).session(session)
  ]);

  const leavePeriodsMap = new Map();
  for (const ds of monthLeaveStatuses) {
    const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
    if (!leavePeriodsMap.has(key)) leavePeriodsMap.set(key, new Set());
    leavePeriodsMap.get(key).add(ds.period);
  }

  const requestByDate = new Map(
    monthRequests.map((r) => [moment.tz(r.date, TZ).format("YYYY-MM-DD"), r])
  );

  const daySnapshots = monthWorksheets.map((ws) => {
    const dateKey = moment.tz(ws.date, TZ).format("YYYY-MM-DD");
    const periods = leavePeriodsMap.get(dateKey);
    const leaveMorning = !!periods && (periods.has("morning") || periods.has("full"));
    const leaveAfternoon = !!periods && (periods.has("afternoon") || periods.has("full"));
    const { checkIn, checkOut } = normalizeDayPunches({
      machineIn: null,
      machineOut: null,
      appIn: ws.check_in ? new Date(ws.check_in) : null,
      appOut: ws.check_out ? new Date(ws.check_out) : null,
      forgot: requestByDate.get(dateKey),
      worksheet: ws,
      leaveMorning,
      leaveAfternoon
    });
    return {
      dateKey,
      hasIn: !!checkIn,
      hasOut: !!checkOut,
      leaveMorning,
      leaveAfternoon
    };
  });

  const occMap = buildUnifiedForgotOccurrenceMap({
    approvedForgotRequests: monthRequests,
    daySnapshots
  });

  const dateKey = moment.tz(date, TZ).format("YYYY-MM-DD");
  return occMap.get(dateKey)?.occurrence || monthRequests.length + 1;
}

module.exports = { validate, validateAsync };
