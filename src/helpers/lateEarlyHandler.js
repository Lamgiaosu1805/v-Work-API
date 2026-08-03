const mongoose = require("mongoose");
const { RequestModel } = require("../models/RequestModel");
const { getPayrollPeriodRange } = require("./payrollPeriod");

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

module.exports = { validate, validateAsync };
