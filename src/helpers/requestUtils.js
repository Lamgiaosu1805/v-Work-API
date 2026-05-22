const moment = require("moment-timezone");
const UserInfoModel = require("../models/UserInfoModel");
const NotificationModel = require("../models/NotificationModel");
const pushNotification = require("./pushNotification");

const TZ = "Asia/Ho_Chi_Minh";

function calcTotalDays(fromDate, fromPeriod, toDate, toPeriod) {
  const from = moment.tz(fromDate, TZ).startOf("day");
  const to = moment.tz(toDate, TZ).startOf("day");
  if (to.isBefore(from)) return null;
  if (
    from.isSame(to, "day") &&
    fromPeriod === "afternoon" &&
    toPeriod === "morning"
  )
    return null;

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
      if (isSat) {
        weight = isFirst && request.from_period === "afternoon" ? 0 : 0.5;
      } else if (isFirst && isLast) {
        weight =
          request.from_period === "morning" && request.to_period === "afternoon"
            ? 1
            : 0.5;
      } else if (isFirst) {
        weight = request.from_period === "morning" ? 1 : 0.5;
      } else if (isLast) {
        weight = request.to_period === "afternoon" ? 1 : 0.5;
      } else {
        weight = 1;
      }
      if (weight > 0) workDates.push({ date: cursor.clone().toDate(), weight });
    }
    cursor.add(1, "day");
  }

  let paidRemaining = request.paid_days;
  return workDates.map(({ date, weight }) => {
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
    return { date, status };
  });
}

async function getEligibleReviewers(userInfoId) {
  const employee = await UserInfoModel.findById(userInfoId, { branch_id: 1 });
  const branchId = employee?.branch_id ?? null;
  if (!branchId) return [];

  const results = await UserInfoModel.aggregate([
    {
      $match: {
        isDeleted: false,
        _id: { $ne: userInfoId },
      },
    },
    {
      $lookup: {
        from: "accounts",
        localField: "id_account",
        foreignField: "_id",
        as: "account",
      },
    },
    { $unwind: "$account" },
    {
      $match: {
        "account.role": "manager",
        // "account.module_access": "hrm",
        "account.isDeleted": false,
        $or: [{ branch_id: branchId }, { "account.dept_scope": "all" }],
      },
    },
    { $project: { _id: 1, full_name: 1, account_id: "$account._id" } },
  ]);

  return results.map((r) => ({
    userInfoId: r._id,
    accountId: r.account_id,
    full_name: r.full_name,
  }));
}

async function notify(accountId, { title, body, type, ref_id, ref_type, uri }) {
  await NotificationModel.create({
    target: "individual",
    account_id: accountId,
    title,
    body,
    type,
    ref_id,
    ref_type,
    uri,
  });
  pushNotification
    .sendToAccount({
      account_id: accountId,
      title,
      body,
      data: { type, uri: uri || "" },
    })
    .catch(() => {});
}

module.exports = {
  calcTotalDays,
  buildWorkDatesWithStatus,
  getEligibleReviewers,
  notify,
};
