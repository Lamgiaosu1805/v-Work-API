const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");

const TZ = "Asia/Ho_Chi_Minh";
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(body) {
  const { visit_date, start_time, end_time } = body;

  if (!visit_date || !moment.tz(visit_date, TZ).isValid())
    return { error: { status: 400, message: "Thông tin đầu vào không hợp lệ" } };

  if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time))
    return { error: { status: 400, message: "Vui lòng nhập giờ bắt đầu/kết thúc hợp lệ (HH:mm)" } };

  if (start_time >= end_time)
    return { error: { status: 400, message: "Giờ kết thúc phải sau giờ bắt đầu" } };

  const dateStr = moment.tz(visit_date, TZ).format("YYYY-MM-DD");

  return {
    payload: {
      from_date: dateStr,
      to_date: dateStr,
      total_days: 1,
      start_time,
      end_time
    }
  };
}

async function validateAsync(payload, userInfo, session) {
  const sameDay = await RequestModel.find({
    user_id: userInfo._id,
    request_type: "client_visit",
    status: { $in: ["pending", "approved"] },
    from_date: new Date(payload.from_date),
    isDeleted: false
  }).session(session);

  const overlap = sameDay.some(
    (r) => payload.start_time < r.end_time && r.start_time < payload.end_time
  );
  return overlap ? { status: 409, message: "Đã có đơn gặp khách hàng trùng khung giờ này" } : null;
}

module.exports = { validate, validateAsync };
