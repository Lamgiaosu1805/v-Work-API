const { RequestModel } = require("../models/RequestModel");
const { calcTotalDays } = require("./requestUtils");
const { createOnApprove } = require("./awayDayHandler");

function validate(body) {
  const { from_date, to_date } = body;

  if (!from_date || !to_date)
    return { error: { status: 400, message: "Thông tin đầu vào không hợp lệ" } };

  const total_days = calcTotalDays(from_date, "morning", to_date, "afternoon");
  if (total_days === null || total_days === 0)
    return { error: { status: 400, message: "Khoảng thời gian không hợp lệ" } };

  return { payload: { from_date, to_date, total_days } };
}

async function validateAsync(payload, userInfo, session) {
  const overlap = await RequestModel.findOne({
    user_id: userInfo._id,
    request_type: "client_visit",
    status: { $in: ["pending", "approved"] },
    from_date: { $lte: new Date(payload.to_date) },
    to_date: { $gte: new Date(payload.from_date) },
    isDeleted: false
  }).session(session);
  return overlap ? { status: 409, message: "Đã có đơn gặp khách hàng cho ngày này" } : null;
}

module.exports = { validate, validateAsync, onApprove: createOnApprove("client_visit") };
