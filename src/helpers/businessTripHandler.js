const { RequestModel } = require("../models/RequestModel");
const { calcTotalDays } = require("./requestUtils");

function validate(body) {
  const { from_date, to_date, origin_location, destination_location } = body;

  if (!from_date || !to_date)
    return { error: { status: 400, message: "Thông tin đầu vào không hợp lệ" } };

  const trimmedOrigin = typeof origin_location === "string" ? origin_location.trim() : "";
  const trimmedDestination =
    typeof destination_location === "string" ? destination_location.trim() : "";
  if (!trimmedOrigin || !trimmedDestination)
    return { error: { status: 400, message: "Vui lòng nhập nơi đi và nơi đến" } };

  const total_days = calcTotalDays(from_date, "morning", to_date, "afternoon");
  if (total_days === null || total_days === 0)
    return { error: { status: 400, message: "Khoảng thời gian không hợp lệ" } };

  return {
    payload: {
      from_date,
      to_date,
      total_days,
      origin_location: trimmedOrigin,
      destination_location: trimmedDestination
    }
  };
}

async function validateAsync(payload, userInfo, session) {
  const overlap = await RequestModel.findOne({
    user_id: userInfo._id,
    request_type: "business_trip",
    status: { $in: ["pending", "approved"] },
    from_date: { $lte: new Date(payload.to_date) },
    to_date: { $gte: new Date(payload.from_date) },
    isDeleted: false
  }).session(session);
  return overlap ? { status: 409, message: "Đã có đơn công tác trong khoảng thời gian này" } : null;
}

module.exports = { validate, validateAsync };
