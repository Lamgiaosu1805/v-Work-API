const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const { calcTotalDays } = require("./requestUtils");

const TZ = "Asia/Ho_Chi_Minh";

function validate(body) {
  const { from_date, to_date } = body;

  if (!from_date || !to_date)
    return { error: { status: 400, message: "Thông tin đầu vào không hợp lệ" } };
  if (moment.tz(from_date, TZ).startOf("day").isBefore(moment.tz(TZ).startOf("day")))
    return { error: { status: 400, message: "Không thể tạo đơn remote cho ngày trong quá khứ" } };

  const total_days = calcTotalDays(from_date, "morning", to_date, "afternoon");
  if (total_days === null || total_days === 0)
    return { error: { status: 400, message: "Khoảng thời gian không hợp lệ" } };

  return { payload: { from_date, to_date, total_days } };
}

async function validateAsync(payload, userInfo, session) {
  const overlap = await RequestModel.findOne({
    user_id:      userInfo._id,
    request_type: "remote",
    status:       { $in: ["pending", "approved"] },
    from_date:    { $lte: new Date(payload.to_date) },
    to_date:      { $gte: new Date(payload.from_date) },
    isDeleted:    false,
  }).session(session);
  return overlap ? { status: 409, message: "Đã có đơn remote trong khoảng thời gian này" } : null;
}

async function onApprove(request, session) {
  const fromMoment = moment.tz(request.from_date, TZ).startOf("day");
  const toMoment   = moment.tz(request.to_date, TZ).startOf("day");
  const fromStart  = fromMoment.toDate();
  const toEnd      = moment.tz(request.to_date, TZ).endOf("day").toDate();

  const workDates = [];
  const cursor = fromMoment.clone();
  while (cursor.isSameOrBefore(toMoment, "day")) {
    if (cursor.day() !== 0) workDates.push(cursor.clone().toDate());
    cursor.add(1, "day");
  }

  await WorkSheetModel.updateMany(
    { user_id: request.user_id, date: { $in: workDates }, isDeleted: false },
    { status: "remote" },
    { session },
  );

  const existing = await WorkSheetModel.find(
    { user_id: request.user_id, date: { $gte: fromStart, $lte: toEnd }, isDeleted: false },
    { date: 1 },
  ).session(session);
  const existingKeys = new Set(existing.map((w) => moment.tz(w.date, TZ).format("YYYY-MM-DD")));

  const missing = workDates.filter((d) => !existingKeys.has(moment.tz(d, TZ).format("YYYY-MM-DD")));
  if (missing.length) {
    await WorkSheetModel.insertMany(
      missing.map((date) => ({ user_id: request.user_id, date, shifts: [], status: "remote" })),
      { session },
    );
  }
}

module.exports = { validate, validateAsync, onApprove };
