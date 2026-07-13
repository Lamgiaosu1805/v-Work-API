const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const ShiftModel = require("../models/ShiftModel");
const { resolveLeaveConflictOnAttendance } = require("./leaveHandler");

const TZ = "Asia/Ho_Chi_Minh";

function validate(body) {
  const { date, type, expected_check_in, expected_check_out } = body;

  if (!date || !type) return { error: { status: 400, message: "Thông tin đầu vào không hợp lệ" } };
  if (!["check_in", "check_out", "both"].includes(type))
    return { error: { status: 400, message: "Loại không hợp lệ" } };

  const dateMoment = moment.tz(date, TZ);

  const needsCheckIn = type === "check_in" || type === "both";
  const needsCheckOut = type === "check_out" || type === "both";

  if (needsCheckIn && !expected_check_in)
    return { error: { status: 400, message: "Vui lòng nhập giờ check-in dự kiến" } };
  if (needsCheckOut && !expected_check_out)
    return { error: { status: 400, message: "Vui lòng nhập giờ check-out dự kiến" } };

  const dayStart = dateMoment.clone().startOf("day");
  const dayEnd = dateMoment.clone().endOf("day");

  if (needsCheckIn) {
    const cin = moment.tz(expected_check_in, TZ);
    if (!cin.isBetween(dayStart, dayEnd, null, "[]"))
      return { error: { status: 400, message: "Giờ check-in dự kiến không hợp lệ" } };
  }
  if (needsCheckOut) {
    const cout = moment.tz(expected_check_out, TZ);
    if (!cout.isBetween(dayStart, dayEnd, null, "[]"))
      return { error: { status: 400, message: "Giờ check-out dự kiến không hợp lệ" } };
  }
  if (needsCheckIn && needsCheckOut) {
    if (moment.tz(expected_check_in, TZ).isSameOrAfter(moment.tz(expected_check_out, TZ)))
      return { error: { status: 400, message: "Giờ check-in phải trước giờ check-out" } };
  }

  return {
    payload: {
      date,
      type,
      expected_check_in: needsCheckIn ? new Date(expected_check_in) : null,
      expected_check_out: needsCheckOut ? new Date(expected_check_out) : null
    }
  };
}

async function validateAsync(payload, userInfo, session) {
  const dup = await RequestModel.findOne({
    user_id: userInfo._id,
    request_type: "forgot_checkin",
    status: { $in: ["pending", "approved"] },
    date: new Date(payload.date),
    isDeleted: false
  }).session(session);
  if (dup) return { status: 409, message: "Đã có đơn quên chấm công cho ngày này" };

  return null;
}

async function onCreate(request, _userInfo, session) {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();
  await WorkDayStatusModel.updateMany(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false
    },
    { $addToSet: { sources: { ref_id: request._id, ref_type: "request" } } },
    { session }
  );
}

async function onReject(request, session) {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();
  await WorkDayStatusModel.updateMany(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false
    },
    { $pull: { sources: { ref_id: request._id, ref_type: "request" } } },
    { session }
  );
}

async function onApprove(request, session) {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();

  const clockUpdate = {};
  if (request.expected_check_in) clockUpdate.check_in = new Date(request.expected_check_in);
  if (request.expected_check_out) clockUpdate.check_out = new Date(request.expected_check_out);

  let worksheet = await WorkSheetModel.findOneAndUpdate(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false
    },
    clockUpdate,
    { session, new: true }
  );

  if (!worksheet) {
    const [created] = await WorkSheetModel.create(
      [{ user_id: request.user_id, date: dateStart, shifts: [], ...clockUpdate }],
      { session }
    );
    worksheet = created;
  }

  let lastShiftEnd = null;
  if (worksheet.shifts?.length > 0) {
    const lastShiftId = worksheet.shifts[worksheet.shifts.length - 1];
    const lastShift = await ShiftModel.findById(lastShiftId).session(session);
    lastShiftEnd = lastShift?.end_time ?? null;
  }

  await resolveLeaveConflictOnAttendance({
    userId: request.user_id,
    worksheetId: worksheet._id,
    date: request.date,
    checkInTime: worksheet.check_in,
    checkOutTime: worksheet.check_out,
    lastShiftEnd,
    session
  });
}

module.exports = { validate, validateAsync, onCreate, onReject, onApprove };
