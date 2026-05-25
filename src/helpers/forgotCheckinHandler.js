const moment = require("moment-timezone");
const mongoose = require("mongoose");
const { RequestModel } = require("../models/RequestModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");

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
  if (dup)
    return { status: 409, message: "Đã có đơn quên chấm công cho ca này" };

  const dateStart = moment.tz(payload.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(payload.date, TZ).endOf("day").toDate();
  const worksheet = await WorkSheetModel.findOne({
    user_id: userInfo._id,
    date: { $gte: dateStart, $lte: dateEnd },
    isDeleted: false,
  }).session(session);

  if (worksheet) {
    if (
      (payload.type === "check_in" || payload.type === "both") &&
      worksheet.check_in
    )
      return {
        status: 400,
        message: "Bạn đã có dữ liệu check-in, không thể tạo đơn quên chấm vào",
      };
    if (
      (payload.type === "check_out" || payload.type === "both") &&
      worksheet.check_out
    )
      return {
        status: 400,
        message: "Bạn đã có dữ liệu check-out, không thể tạo đơn quên chấm ra",
      };
  }

  return null;
}

async function onApprove(request, session) {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();

  const clockUpdate = {};
  if (request.expected_check_in)
    clockUpdate.check_in = new Date(request.expected_check_in);
  if (request.expected_check_out)
    clockUpdate.check_out = new Date(request.expected_check_out);

  let worksheet = await WorkSheetModel.findOneAndUpdate(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false,
    },
    clockUpdate,
    { session, new: true },
  );

  if (!worksheet) {
    const [created] = await WorkSheetModel.create(
      [
        {
          user_id: request.user_id,
          date: dateStart,
          shifts: [request.shift_id],
          ...clockUpdate,
        },
      ],
      { session },
    );
    worksheet = created;
  }

  await WorkDayStatusModel.findOneAndUpdate(
    {
      user_id: request.user_id,
      date: dateStart,
      period: "full",
      isDeleted: false,
    },
    {
      worksheet_id: worksheet._id,
      status: "missed_clock",
      $addToSet: { sources: { ref_id: request._id, ref_type: "request" } },
    },
    { upsert: true, session, new: true },
  );
}

module.exports = { validate, validateAsync, onApprove };
