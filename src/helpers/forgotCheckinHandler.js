const moment = require("moment-timezone");
const mongoose = require("mongoose");
const { RequestModel } = require("../models/RequestModel");
const WorkSheetModel = require("../models/WorkSheetModel");

const TZ = "Asia/Ho_Chi_Minh";

function validate(body) {
  const { date, shift_id, type, expected_check_in, expected_check_out } = body;

  if (!date || !shift_id || !type)
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" },
    };
  if (!["check_in", "check_out", "both"].includes(type))
    return { error: { status: 400, message: "Loại không hợp lệ" } };
  if (!mongoose.Types.ObjectId.isValid(shift_id))
    return { error: { status: 400, message: "Ca làm không hợp lệ" } };
  if (moment.tz(date, TZ).isAfter(moment.tz(TZ).endOf("day")))
    return { error: { status: 400, message: "Ngày không hợp lệ" } };
  if ((type === "check_in" || type === "both") && !expected_check_in)
    return {
      error: { status: 400, message: "Vui lòng cung cấp giờ check-in dự kiến" },
    };
  if ((type === "check_out" || type === "both") && !expected_check_out)
    return {
      error: {
        status: 400,
        message: "Vui lòng cung cấp giờ check-out dự kiến",
      },
    };

  return {
    payload: {
      date,
      shift_id,
      type,
      expected_check_in: expected_check_in || null,
      expected_check_out: expected_check_out || null,
    },
  };
}

async function validateAsync(payload, userInfo, session) {
  const dup = await RequestModel.findOne({
    user_id: userInfo._id,
    request_type: "forgot_checkin",
    status: { $in: ["pending", "approved"] },
    date: new Date(payload.date),
    shift_id: payload.shift_id,
    isDeleted: false,
  }).session(session);
  return dup
    ? { status: 409, message: "Đã có đơn quên chấm công cho ca này" }
    : null;
}

async function onApprove(request, session) {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();

  const update = {};
  if (request.expected_check_in) update.check_in = request.expected_check_in;
  if (request.expected_check_out) update.check_out = request.expected_check_out;

  const existing = await WorkSheetModel.findOneAndUpdate(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false,
    },
    update,
    { session, new: true },
  );

  if (!existing) {
    await WorkSheetModel.create(
      [
        {
          user_id: request.user_id,
          date: request.date,
          shifts: [request.shift_id],
          status: "pending",
          ...update,
        },
      ],
      { session },
    );
  }
}

module.exports = { validate, validateAsync, onApprove };
