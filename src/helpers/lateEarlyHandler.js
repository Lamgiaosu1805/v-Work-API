const moment = require("moment-timezone");
const mongoose = require("mongoose");
const { RequestModel } = require("../models/RequestModel");
const { getPayrollPeriodRange } = require("./payrollPeriod");
const {
  processAttendanceDay,
  getWorksheetForDay,
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver
} = require("../modules/timesheet");
const { buildUserDayContext } = require("../jobs/finalizeWorkDay");

const TZ = "Asia/Ho_Chi_Minh";

function validate(body) {
  const { date, shift_id, type, minutes } = body;

  if (!date || !shift_id || !type || minutes == null)
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" }
    };
  if (!["late", "early_out"].includes(type))
    return { error: { status: 400, message: "Loại không hợp lệ" } };
  if (!mongoose.Types.ObjectId.isValid(shift_id))
    return { error: { status: 400, message: "Ca làm không hợp lệ" } };
  if (typeof minutes !== "number" || minutes <= 0)
    return { error: { status: 400, message: "Số phút không hợp lệ" } };

  return { payload: { date, shift_id, type, minutes } };
}

async function validateAsync(payload, userInfo, session) {
  const dup = await RequestModel.findOne({
    user_id: userInfo._id,
    request_type: "late_early",
    status: { $in: ["pending", "approved"] },
    date: new Date(payload.date),
    shift_id: payload.shift_id,
    type: payload.type,
    isDeleted: false
  }).session(session);
  if (dup) return { status: 409, message: "Đã có đơn cho ca này" };

  const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(payload.date);
  const priorCount = await RequestModel.countDocuments({
    user_id: userInfo._id,
    request_type: "late_early",
    status: { $in: ["pending", "approved"] },
    isDeleted: false,
    date: { $gte: periodStart, $lte: periodEnd }
  }).session(session);

  return { occurrence: priorCount + 1 };
}

async function onApprove(request, session) {
  const dateKey = moment.tz(request.date, TZ).format("YYYY-MM-DD");
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();

  const worksheet = await getWorksheetForDay(request.user_id.toString(), dateStart, session);
  if (!worksheet || (!worksheet.check_in && !worksheet.check_out)) return;

  const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(request.date);
  const [context, resolveLatePenalty, resolveEarlyPenalty, resolveForgotPenalty] =
    await Promise.all([
      buildUserDayContext(
        request.user_id,
        dateKey,
        dateStart,
        dateEnd,
        periodStart,
        periodEnd,
        session
      ),
      buildLatePenaltyResolver(),
      buildEarlyPenaltyResolver(),
      buildForgotPenaltyResolver()
    ]);

  await processAttendanceDay({
    userId: request.user_id.toString(),
    worksheetId: worksheet.id,
    dateKey,
    rawIn: worksheet.check_in ? moment.tz(worksheet.check_in, TZ).format("HH:mm") : null,
    rawOut: worksheet.check_out ? moment.tz(worksheet.check_out, TZ).format("HH:mm") : null,
    worksheet,
    ...context,
    resolveLatePenalty,
    resolveEarlyPenalty,
    resolveForgotPenalty,
    session
  });
}

module.exports = { validate, validateAsync, onApprove };
