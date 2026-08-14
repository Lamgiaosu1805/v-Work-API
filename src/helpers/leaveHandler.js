const moment = require("moment-timezone");
const { RequestModel } = require("../models/RequestModel");
const HolidayModel = require("../models/HolidayModel");
const EmploymentStatusModel = require("../models/EmploymentStatusModel");
const { calcTotalDays } = require("./requestUtils");
const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");
const { getLeaveBalance } = require("../modules/leave");

const TZ = "Asia/Ho_Chi_Minh";
const RETROACTIVE_LIMIT_DAYS = 3;
// SRS (update 3/8/2026): chỉ được ứng trước tối đa 1 ngày phép của tháng liền kề sau — không còn
// cộng dồn không giới hạn theo số tháng (monthDiff * MONTHLY_ACCRUAL cũ cho phép ứng trước cả năm).
const ADVANCE_BORROW_MAX_DAYS = 1;

async function validate(body, userInfo) {
  const { from_date, from_period, to_date, to_period, leave_type } = body;

  if (!from_date || !from_period || !to_date || !to_period || !leave_type)
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" }
    };
  if (!["paid", "unpaid"].includes(leave_type))
    return {
      error: { status: 400, message: "Thông tin đầu vào không hợp lệ" }
    };
  if (
    !["morning", "afternoon"].includes(from_period) ||
    !["morning", "afternoon"].includes(to_period)
  )
    return { error: { status: 400, message: "Buổi nghỉ không hợp lệ" } };

  const now = moment.tz(TZ);
  const today = now.clone().startOf("day");
  const fromMoment = moment.tz(from_date, TZ).startOf("day");

  if (fromMoment.isBefore(today.clone().subtract(RETROACTIVE_LIMIT_DAYS, "days")))
    return {
      error: {
        status: 400,
        message: `Chỉ được tạo đơn trong vòng ${RETROACTIVE_LIMIT_DAYS} ngày gần nhất`
      }
    };

  const total_days = calcTotalDays(from_date, from_period, to_date, to_period);
  if (total_days === null || total_days === 0)
    return {
      error: { status: 400, message: "Khoảng thời gian nghỉ không hợp lệ" }
    };

  const balance = await getLeaveBalance(userInfo._id);
  const monthDiff = fromMoment.diff(moment.tz(TZ).startOf("month"), "months");
  const advanceBorrow = monthDiff === 1 ? Math.min(MONTHLY_ACCRUAL, ADVANCE_BORROW_MAX_DAYS) : 0;
  const projectedBalance = balance + advanceBorrow;

  if (leave_type === "paid" && projectedBalance <= 0)
    return {
      error: { status: 400, message: "Bạn không còn ngày nghỉ phép có lương" }
    };

  const paid_days = leave_type === "paid" ? Math.min(total_days, Math.max(0, projectedBalance)) : 0;
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
      unpaid_days
    }
  };
}

function toSlot(date, period) {
  return `${moment.tz(date, TZ).format("YYYY-MM-DD")}_${period === "morning" ? "0" : "1"}`;
}

async function validateAsync(payload, userInfo, session) {
  if (payload.leave_type === "paid" && userInfo.employment_status) {
    const empStatus = await EmploymentStatusModel.findById(userInfo.employment_status);
    if (empStatus && !empStatus.can_use_annual_leave)
      return {
        status: 403,
        message: "Loại hợp đồng hiện tại chưa được sử dụng ngày phép có lương"
      };
  }

  const fromDate = moment.tz(payload.from_date, TZ).startOf("day").toDate();
  const toDate = moment.tz(payload.to_date, TZ).startOf("day").toDate();

  const rawFromDate = new Date(payload.from_date);
  const rawToDate = new Date(payload.to_date);

  const candidates = await RequestModel.find({
    user_id: userInfo._id,
    request_type: "leave",
    status: { $in: ["pending", "approved"] },
    from_date: { $lte: rawToDate },
    to_date: { $gte: rawFromDate },
    isDeleted: false
  }).session(session);

  const newFrom = toSlot(payload.from_date, payload.from_period);
  const newTo = toSlot(payload.to_date, payload.to_period);
  const overlap = candidates.find((r) => {
    return newFrom <= toSlot(r.to_date, r.to_period) && toSlot(r.from_date, r.from_period) <= newTo;
  });
  if (overlap) return { status: 409, message: "Đã có đơn nghỉ trong khoảng thời gian này" };

  const holidays = await HolidayModel.find({
    date: { $gte: fromDate, $lte: toDate },
    isDeleted: false
  }).session(session);

  const userBranchId = userInfo.branch_id?.toString();
  const applicableHolidays = holidays.filter((h) => {
    if (h.scope_type === "all") return true;
    return userBranchId && h.branches.some((b) => b.toString() === userBranchId);
  });

  const workingHolidays = applicableHolidays.filter((h) => moment.tz(h.date, TZ).day() !== 0);
  if (workingHolidays.length) {
    const names = workingHolidays.map((h) => h.name).join(", ");
    return {
      status: 400,
      message: `Khoảng thời gian nghỉ chứa ngày lễ: ${names}. Vui lòng tách đơn.`
    };
  }

  return null;
}

module.exports = {
  validate,
  validateAsync
};
