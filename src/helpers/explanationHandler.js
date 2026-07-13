const moment = require("moment-timezone");
const mongoose = require("mongoose");

const TZ = "Asia/Ho_Chi_Minh";

function validate(body) {
  const { date, content, shift_id } = body;

  if (!date || !content)
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" },
    };
  if (moment.tz(date, TZ).isAfter(moment.tz(TZ).endOf("day")))
    return { error: { status: 400, message: "Ngày không hợp lệ" } };

  const payload = { date, content };
  if (shift_id && mongoose.Types.ObjectId.isValid(shift_id))
    payload.shift_id = shift_id;
  return { payload };
}

async function validateAsync() {
  return null;
}

module.exports = { validate, validateAsync };
