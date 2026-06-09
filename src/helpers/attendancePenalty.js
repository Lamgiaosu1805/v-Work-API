const AttendancePenaltyModel = require("../models/AttendancePenaltyModel");

async function buildLatePenaltyResolver() {
  const all = await AttendancePenaltyModel.find({
    type: "late",
    is_active: true,
    isDeleted: false,
  }).sort({ effective_from: -1, from_minutes: 1 });

  const generations = [...new Set(all.map((t) => t.effective_from.getTime()))].sort(
    (a, b) => b - a,
  );

  return function resolve(dateObj, minutesLate, isSaturday) {
    const base = isSaturday ? 0.5 : 1;

    if (!minutesLate || minutesLate <= 0)
      return { work_unit: base, penalty_amount: 0, morning_absent: false };

    const genTime = generations.find((g) => g <= dateObj.getTime());
    if (genTime == null)
      return { work_unit: base, penalty_amount: 0, morning_absent: false };

    const tiers = all.filter((t) => t.effective_from.getTime() === genTime);
    const tier = tiers.find(
      (t) =>
        minutesLate >= t.from_minutes &&
        (t.to_minutes == null || minutesLate <= t.to_minutes),
    );

    if (!tier) return { work_unit: 0.5, penalty_amount: 0, morning_absent: true };

    if (tier.penalty_kind === "money")
      return { work_unit: base, penalty_amount: tier.penalty_value, morning_absent: false };

    return {
      work_unit: Math.max(0, base - tier.penalty_value),
      penalty_amount: 0,
      morning_absent: false,
    };
  };
}

module.exports = { buildLatePenaltyResolver };
