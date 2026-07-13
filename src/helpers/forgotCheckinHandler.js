const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const ShiftModel = require("../models/ShiftModel");
const { resolveLeaveConflictOnAttendance } = require("./leaveHandler");
const { buildForgotPenaltyResolver } = require("./attendancePenalty");

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

  const existing = await WorkSheetModel.findOne({
    user_id: request.user_id,
    date: { $gte: dateStart, $lte: dateEnd },
    isDeleted: false
  }).session(session);

  const clockUpdate = {};
  if (request.expected_check_in) {
    if (
      request.type === "check_in" &&
      existing?.check_in &&
      !existing?.check_out &&
      new Date(existing.check_in) > new Date(request.expected_check_in)
    ) {
      clockUpdate.check_out = existing.check_in;
    }
    clockUpdate.check_in = new Date(request.expected_check_in);
  }
  if (request.expected_check_out) {
    if (
      request.type === "check_out" &&
      existing?.check_out &&
      !existing?.check_in &&
      new Date(existing.check_out) < new Date(request.expected_check_out)
    ) {
      clockUpdate.check_in = existing.check_out;
    }
    clockUpdate.check_out = new Date(request.expected_check_out);
  }

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

  // Excel import mới tính lại work_unit cho ngày quên chấm công; nếu chưa import lại
  // sau khi duyệt, công sẽ treo ở giá trị cũ (thường là 0). Tính luôn work_unit ở đây
  // để công đúng ngay khi duyệt, không phải chờ import Excel. Import Excel sau này vẫn
  // là nguồn tính chính thức (có gộp thêm dữ liệu máy chấm công/nghỉ phép), giá trị ở
  // đây chỉ là kết quả tạm thời hợp lý ngay sau khi duyệt.
  if (worksheet.check_in && worksheet.check_out) {
    const monthStart = moment.tz(request.date, TZ).startOf("month").toDate();
    const monthEnd = moment.tz(request.date, TZ).endOf("month").toDate();
    const monthRequests = await RequestModel.find({
      user_id: request.user_id,
      request_type: "forgot_checkin",
      status: "approved",
      isDeleted: false,
      date: { $gte: monthStart, $lte: monthEnd }
    })
      .sort({ date: 1 })
      .session(session);

    const occurrence = monthRequests.findIndex((r) => r._id.equals(request._id)) + 1;
    const isSaturday = moment.tz(request.date, TZ).day() === 6;
    const dayStart = moment.tz(request.date, TZ).startOf("day").toDate();

    const resolveForgotPenalty = await buildForgotPenaltyResolver();
    const { work_unit, penalty_amount } = resolveForgotPenalty(
      dayStart,
      occurrence || monthRequests.length,
      isSaturday
    );
    worksheet.work_unit = work_unit;
    worksheet.penalty_amount = penalty_amount;
    await worksheet.save({ session });
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
