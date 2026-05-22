const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const UserInfoModel = require("../models/UserInfoModel");
const WorkSheetModel = require("../models/WorkSheetModel");
const HolidayModel = require("../models/HolidayModel");
const { calcTotalDays, buildWorkDatesWithStatus } = require("./requestUtils");

const TZ = "Asia/Ho_Chi_Minh";
const RETROACTIVE_LIMIT_DAYS = 3;

function validate(body, userInfo) {
  const {
    from_date,
    from_period,
    to_date,
    to_period,
    leave_type,
    is_retroactive,
  } = body;

  if (!from_date || !from_period || !to_date || !to_period || !leave_type)
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" },
    };
  if (!["paid", "unpaid"].includes(leave_type))
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" },
    };
  if (
    !["morning", "afternoon"].includes(from_period) ||
    !["morning", "afternoon"].includes(to_period)
  )
    return { error: { status: 400, message: "Buổi nghỉ không hợp lệ" } };

  const now = moment.tz(TZ);
  const today = now.clone().startOf("day");
  const fromMoment = moment.tz(from_date, TZ).startOf("day");

  if (is_retroactive) {
    const limit = today.clone().subtract(RETROACTIVE_LIMIT_DAYS, "days");
    if (fromMoment.isBefore(limit))
      return {
        error: {
          status: 400,
          message: `Chỉ được nộp đơn muộn trong vòng ${RETROACTIVE_LIMIT_DAYS} ngày`,
        },
      };
    if (fromMoment.isSameOrAfter(today))
      return {
        error: { status: 400, message: "Đơn muộn phải là ngày trong quá khứ" },
      };
  } else {
    if (fromMoment.isBefore(today))
      return {
        error: {
          status: 400,
          message: "Không thể tạo đơn nghỉ cho ngày trong quá khứ",
        },
      };
    if (
      fromMoment.isSame(today, "day") &&
      from_period === "morning" &&
      now.isSameOrAfter(today.clone().hour(12))
    )
      return {
        error: {
          status: 400,
          message: "Không thể tạo đơn nghỉ cho buổi đã qua",
        },
      };
  }

  const total_days = calcTotalDays(from_date, from_period, to_date, to_period);
  if (total_days === null || total_days === 0)
    return {
      error: { status: 400, message: "Khoảng thời gian nghỉ không hợp lệ" },
    };

  const balance = userInfo.leave_balance?.annual ?? 0;
  if (leave_type === "paid" && balance <= 0)
    return {
      error: { status: 400, message: "Bạn không còn ngày nghỉ phép có lương" },
    };

  const paid_days = leave_type === "paid" ? Math.min(total_days, balance) : 0;
  const unpaid_days = total_days - paid_days;

  return {
    payload: {
      from_date,
      from_period,
      to_date,
      to_period,
      total_days,
      leave_type,
      paid_days,
      unpaid_days,
      is_retroactive: !!is_retroactive,
    },
  };
}

async function validateAsync(payload, userInfo, session) {
  const fromDate = new Date(payload.from_date);
  const toDate = new Date(payload.to_date);

  const [overlap, holidays] = await Promise.all([
    RequestModel.findOne({
      user_id: userInfo._id,
      request_type: "leave",
      status: { $in: ["pending", "approved"] },
      from_date: { $lte: toDate },
      to_date: { $gte: fromDate },
      isDeleted: false,
    }).session(session),
    HolidayModel.find({
      date: { $gte: fromDate, $lte: toDate },
      isDeleted: false,
    }).session(session),
  ]);

  if (overlap)
    return { status: 409, message: "Đã có đơn nghỉ trong khoảng thời gian này" };

  const workingHolidays = holidays.filter((h) => moment.tz(h.date, TZ).day() !== 0);
  if (workingHolidays.length) {
    const names = workingHolidays.map((h) => h.name).join(", ");
    return {
      status: 400,
      message: `Khoảng thời gian nghỉ chứa ngày lễ: ${names}. Vui lòng tách đơn.`,
    };
  }

  return null;
}

async function onCreate(request, userInfo, session) {
  if (request.paid_days > 0) {
    await UserInfoModel.findByIdAndUpdate(
      userInfo._id,
      { $inc: { "leave_balance.annual": -request.paid_days } },
      { session },
    );
  }
  return null;
}

async function onApprove(request, session) {
  const fromMoment = moment.tz(request.from_date, TZ).startOf("day");
  const toMoment = moment.tz(request.to_date, TZ).startOf("day");
  const fromStart = fromMoment.toDate();
  const toEnd = moment.tz(request.to_date, TZ).endOf("day").toDate();

  const datesWithStatus = buildWorkDatesWithStatus(
    request,
    fromMoment,
    toMoment,
  );
  const paidDates = datesWithStatus
    .filter((d) => d.status === "leave_paid")
    .map((d) => d.date);
  const unpaidDates = datesWithStatus
    .filter((d) => d.status === "leave_unpaid")
    .map((d) => d.date);

  if (paidDates.length) {
    await WorkSheetModel.updateMany(
      { user_id: request.user_id, date: { $in: paidDates }, isDeleted: false },
      { status: "leave_paid" },
      { session },
    );
  }
  if (unpaidDates.length) {
    await WorkSheetModel.updateMany(
      {
        user_id: request.user_id,
        date: { $in: unpaidDates },
        isDeleted: false,
      },
      { status: "leave_unpaid" },
      { session },
    );
  }

  const existing = await WorkSheetModel.find(
    {
      user_id: request.user_id,
      date: { $gte: fromStart, $lte: toEnd },
      isDeleted: false,
    },
    { date: 1 },
  ).session(session);
  const existingKeys = new Set(
    existing.map((w) => moment.tz(w.date, TZ).format("YYYY-MM-DD")),
  );

  const missing = datesWithStatus.filter(
    (d) => !existingKeys.has(moment.tz(d.date, TZ).format("YYYY-MM-DD")),
  );
  if (missing.length) {
    await WorkSheetModel.insertMany(
      missing.map(({ date, status }) => ({
        user_id: request.user_id,
        date,
        shifts: [],
        status,
      })),
      { session },
    );
  }
}

async function onReject(request, session) {
  if (request.paid_days > 0) {
    await UserInfoModel.findByIdAndUpdate(
      request.user_id,
      { $inc: { "leave_balance.annual": request.paid_days } },
      { session },
    );
  }
}

module.exports = { validate, validateAsync, onCreate, onApprove, onReject };
