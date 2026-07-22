const moment = require("moment-timezone");
const AttendancePenaltyModel = require("../models/AttendancePenaltyModel");

const TZ = "Asia/Ho_Chi_Minh";

async function buildLatePenaltyResolver() {
  const all = await AttendancePenaltyModel.find({
    type: "late",
    is_active: true,
    isDeleted: false
  }).sort({ effective_from: -1, from_minutes: 1 });

  const generations = [...new Set(all.map((t) => t.effective_from.getTime()))].sort(
    (a, b) => b - a
  );

  return function resolve(dateObj, minutesLate, isSaturday) {
    const base = isSaturday ? 0.5 : 1;

    if (!minutesLate || minutesLate <= 0)
      return { work_unit: base, penalty_amount: 0, morning_absent: false };

    const genTime = generations.find((g) => g <= dateObj.getTime());
    if (genTime == null) return { work_unit: base, penalty_amount: 0, morning_absent: false };

    const tiers = all.filter((t) => t.effective_from.getTime() === genTime);
    const tier = tiers.find(
      (t) => minutesLate >= t.from_minutes && (t.to_minutes == null || minutesLate <= t.to_minutes)
    );

    if (!tier) return { work_unit: 0.5, penalty_amount: 0, morning_absent: true };

    if (tier.penalty_kind === "money")
      return { work_unit: base, penalty_amount: tier.penalty_value, morning_absent: false };

    if (tier.penalty_kind === "half_day_money")
      return { work_unit: 0.5, penalty_amount: tier.penalty_value, morning_absent: true };

    return {
      work_unit: Math.max(0, base - tier.penalty_value),
      penalty_amount: 0,
      morning_absent: false
    };
  };
}

async function buildEarlyPenaltyResolver() {
  const all = await AttendancePenaltyModel.find({
    type: "early",
    is_active: true,
    isDeleted: false
  }).sort({ effective_from: -1, from_minutes: 1 });

  const generations = [...new Set(all.map((t) => t.effective_from.getTime()))].sort(
    (a, b) => b - a
  );

  return function resolve(dateObj, minutesEarly, isSaturday) {
    const base = isSaturday ? 0.5 : 1;

    if (!minutesEarly || minutesEarly <= 0)
      return { work_unit: base, penalty_amount: 0, afternoon_absent: false };

    const genTime = generations.find((g) => g <= dateObj.getTime());
    if (genTime == null) return { work_unit: base, penalty_amount: 0, afternoon_absent: false };

    const tiers = all.filter((t) => t.effective_from.getTime() === genTime);
    const tier = tiers.find(
      (t) =>
        minutesEarly >= t.from_minutes && (t.to_minutes == null || minutesEarly <= t.to_minutes)
    );

    if (!tier) return { work_unit: 0.5, penalty_amount: 0, afternoon_absent: true };

    if (tier.penalty_kind === "money")
      return { work_unit: base, penalty_amount: tier.penalty_value, afternoon_absent: false };

    if (tier.penalty_kind === "half_day_money")
      return { work_unit: 0.5, penalty_amount: tier.penalty_value, afternoon_absent: true };

    return {
      work_unit: Math.max(0, base - tier.penalty_value),
      penalty_amount: 0,
      afternoon_absent: false
    };
  };
}

async function buildForgotPenaltyResolver() {
  const all = await AttendancePenaltyModel.find({
    type: "forgot",
    is_active: true,
    isDeleted: false
  }).sort({ effective_from: -1, from_count: 1 });

  const generations = [...new Set(all.map((t) => t.effective_from.getTime()))].sort(
    (a, b) => b - a
  );

  return function resolve(dateObj, count, isSaturday) {
    const base = isSaturday ? 0.5 : 1;

    if (!count || count <= 0) return { work_unit: base, penalty_amount: 0 };

    const genTime = generations.find((g) => g <= dateObj.getTime());
    if (genTime == null) return { work_unit: base, penalty_amount: 0 };

    const tiers = all.filter((t) => t.effective_from.getTime() === genTime);
    const tier = tiers.find(
      (t) => count >= t.from_count && (t.to_count == null || count <= t.to_count)
    );

    if (!tier) return { work_unit: base, penalty_amount: 0 };

    if (tier.penalty_kind === "money")
      return { work_unit: base, penalty_amount: tier.penalty_value };

    return { work_unit: base / 2, penalty_amount: 0 };
  };
}

function buildUnifiedForgotOccurrenceMap({ approvedForgotRequests, daySnapshots }) {
  const requestDateKeys = new Set(
    (approvedForgotRequests || []).map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD"))
  );

  const autoDateKeys = (daySnapshots || [])
    .filter((d) => {
      if (requestDateKeys.has(d.dateKey)) return false;
      const missedIn = !d.hasIn && !d.leaveMorning;
      const missedOut = !d.hasOut && !d.leaveAfternoon;
      const isPartial = (d.hasIn && !d.hasOut) || (!d.hasIn && d.hasOut);
      return isPartial && (missedIn || missedOut);
    })
    .map((d) => d.dateKey);

  const merged = [
    ...[...requestDateKeys].map((dateKey) => ({ dateKey, hasRequest: true })),
    ...autoDateKeys.map((dateKey) => ({ dateKey, hasRequest: false }))
  ].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));

  const map = new Map();
  merged.forEach((item, idx) => {
    map.set(item.dateKey, { occurrence: idx + 1, hasRequest: item.hasRequest });
  });
  return map;
}

module.exports = {
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver,
  buildUnifiedForgotOccurrenceMap
};
