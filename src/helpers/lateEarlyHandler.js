const moment = require("moment-timezone");
const mongoose = require("mongoose");
const { RequestModel } = require("../models/RequestModel");
const WorkSheetModel = require("../models/WorkSheetModel");

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
  return dup ? { status: 409, message: "Đã có đơn cho ca này" } : null;
}

async function onApprove(request, session) {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();
  const field = request.type === "late" ? "minutes_late" : "minute_early";

  await WorkSheetModel.updateOne(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false
    },
    { $set: { [field]: 0 } },
    { session }
  );
}

module.exports = { validate, validateAsync, onApprove };
