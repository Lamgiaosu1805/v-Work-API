const moment = require("moment-timezone");
const notificationService = require("../services/notificationService");
const redis = require("../config/redis");
const UserInfoModel = require("../models/UserInfoModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");

const TZ = "Asia/Ho_Chi_Minh";

const REVIEW_LOCK_TTL_MS = 5000;
const REVIEW_LOCK_WAIT_BUDGET_MS = 10000;
const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");

class RequestReviewLockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function acquireRequestReviewLock(requestId) {
  const key = `${ENV_PREFIX}:request_review:lock:${String(requestId)}`;
  const token = `${Date.now()}-${Math.random()}`;
  const deadline = Date.now() + REVIEW_LOCK_WAIT_BUDGET_MS;

  while (Date.now() < deadline) {
    const ok = await redis.set(key, token, "PX", REVIEW_LOCK_TTL_MS, "NX");
    if (ok === "OK") {
      return async () => {
        try {
          const val = await redis.get(key);
          if (val === token) await redis.del(key);
        } catch {
          // best-effort release — TTL là lưới an toàn thực sự
        }
      };
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50 + Math.random() * 50);
    });
  }
  throw new RequestReviewLockError(409, "Đơn đang được xử lý duyệt, vui lòng thử lại");
}

function calcTotalDays(fromDate, fromPeriod, toDate, toPeriod) {
  const from = moment.tz(fromDate, TZ).startOf("day");
  const to = moment.tz(toDate, TZ).startOf("day");
  if (to.isBefore(from)) return null;
  if (from.isSame(to, "day") && fromPeriod === "afternoon" && toPeriod === "morning") return null;

  let total = 0;
  const cursor = from.clone();
  while (cursor.isSameOrBefore(to, "day")) {
    const dow = cursor.day();
    if (dow === 0) {
      cursor.add(1, "day");
      continue;
    }
    const isFirst = cursor.isSame(from, "day");
    const isLast = cursor.isSame(to, "day");
    if (dow === 6) {
      total += isFirst && fromPeriod === "afternoon" ? 0 : 0.5;
    } else if (isFirst && isLast) {
      total += fromPeriod === "morning" && toPeriod === "afternoon" ? 1 : 0.5;
    } else if (isFirst) {
      total += fromPeriod === "morning" ? 1 : 0.5;
    } else if (isLast) {
      total += toPeriod === "afternoon" ? 1 : 0.5;
    } else {
      total += 1;
    }
    cursor.add(1, "day");
  }
  return total;
}

function buildWorkDatesWithStatus(request, fromMoment, toMoment) {
  const workDates = [];
  const cursor = fromMoment.clone();
  while (cursor.isSameOrBefore(toMoment, "day")) {
    const dow = cursor.day();
    if (dow !== 0) {
      const isFirst = cursor.isSame(fromMoment, "day");
      const isLast = cursor.isSame(toMoment, "day");
      const isSat = dow === 6;
      let weight;
      let period;
      if (isSat) {
        weight = isFirst && request.from_period === "afternoon" ? 0 : 0.5;
        period = "full";
      } else if (isFirst && isLast) {
        weight = request.from_period === "morning" && request.to_period === "afternoon" ? 1 : 0.5;
        if (request.from_period === "morning" && request.to_period === "afternoon") period = "full";
        else if (request.from_period === "morning") period = "morning";
        else period = "afternoon";
      } else if (isFirst) {
        weight = request.from_period === "morning" ? 1 : 0.5;
        period = request.from_period === "morning" ? "full" : "afternoon";
      } else if (isLast) {
        weight = request.to_period === "afternoon" ? 1 : 0.5;
        period = request.to_period === "afternoon" ? "full" : "morning";
      } else {
        weight = 1;
        period = "full";
      }
      if (weight > 0) workDates.push({ date: cursor.clone().toDate(), weight, period });
    }
    cursor.add(1, "day");
  }

  let paidRemaining = request.paid_days;
  return workDates.map(({ date, weight, period }) => {
    let status;
    if (paidRemaining >= weight - 0.001) {
      status = "leave_paid";
      paidRemaining -= weight;
    } else if (paidRemaining > 0) {
      status = "leave_paid";
      paidRemaining = 0;
    } else {
      status = "leave_unpaid";
    }
    return { date, status, period, weight };
  });
}

async function notify(accountId, { title, body, type, ref_id, ref_type, uri }) {
  await notificationService.createNotification({
    account_id: accountId,
    title,
    body,
    type,
    ref_id,
    ref_type,
    uri
  });
}

function calcWorkUnit(shifts, minutesLate, minuteEarly) {
  const totalMinutes = shifts.reduce((sum, shift) => {
    if (!shift.start_time || !shift.end_time) return sum;
    const [sh, sm] = shift.start_time.split(":").map(Number);
    const [eh, em] = shift.end_time.split(":").map(Number);
    return sum + (eh * 60 + em) - (sh * 60 + sm);
  }, 0);
  const base = totalMinutes >= 540 ? 1 : 0.5;
  const lateDeduction = minutesLate >= 60 ? 0.5 : 0;
  const earlyDeduction = minuteEarly >= 60 ? 0.5 : 0;
  return Math.max(0, base - lateDeduction - earlyDeduction);
}

async function resolveReviewerProfileByAccountId(accountId) {
  if (!accountId) return null;
  const userInfo = await UserInfoModel.findOne(
    { id_account: accountId, isDeleted: false },
    { full_name: 1 }
  );
  if (!userInfo) return null;

  const membership = await UserDepartmentPositionModel.findOne({
    user: userInfo._id,
    isDeleted: false
  })
    .populate("position", "position_name")
    .populate("department", "department_name");

  return {
    userInfoId: userInfo._id,
    full_name: userInfo.full_name,
    position_name: membership?.position?.position_name ?? null,
    department_name: membership?.department?.department_name ?? null
  };
}

module.exports = {
  calcTotalDays,
  buildWorkDatesWithStatus,
  notify,
  calcWorkUnit,
  acquireRequestReviewLock,
  RequestReviewLockError,
  resolveReviewerProfileByAccountId
};
