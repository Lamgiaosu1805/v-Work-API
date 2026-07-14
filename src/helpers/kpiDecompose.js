const KpiPeriodTargetModel = require("../models/KpiPeriodTargetModel");
const HolidayModel = require("../models/HolidayModel");
const { KPI_PERIOD_TYPE, KPI_SCOPE_TYPE } = require("../constants");
const { dayKey, monthRange, weekKey, weekRange } = require("./kpiPeriod");

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function getWorkingDays(year, month) {
  const { start, end } = monthRange(year, month);

  const holidays = await HolidayModel.find({
    date: { $gte: start, $lt: end },
    scope_type: "all",
    isDeleted: false
  })
    .select("date")
    .lean();
  const holidaySet = new Set(holidays.map((h) => dayKey(h.date)));

  const days = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const isSunday = cursor.getDay() === 0;
    if (!isSunday && !holidaySet.has(dayKey(cursor))) days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function computeDayTargets(monthTarget, workingDays) {
  const n = workingDays.length;
  if (!n || !monthTarget) return workingDays.map((date) => ({ date, base_target: 0 }));

  const perDay = round2(monthTarget / n);
  const results = workingDays.map((date) => ({ date, base_target: perDay }));

  const allocated = round2(perDay * (n - 1));
  results[n - 1].base_target = round2(monthTarget - allocated);
  return results;
}

async function upsertPeriodTarget({ scopeType, scopeId, metricCode, periodType, periodKey, baseTarget, session }) {
  const key = {
    scope_type: scopeType,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: periodType,
    period_key: periodKey
  };

  const query = KpiPeriodTargetModel.findOne({ ...key, isDeleted: false });
  if (session) query.session(session);
  const existing = await query;

  if (existing) {
    if (existing.is_closed) return existing;
    existing.base_target = baseTarget;
    existing.effective_target = round2(baseTarget + (existing.rollover_in || 0));
    existing.achievement_pct =
      existing.effective_target > 0
        ? round2((existing.actual / existing.effective_target) * 100)
        : 0;
    await existing.save(session ? { session } : undefined);
    return existing;
  }

  const created = await KpiPeriodTargetModel.create(
    [
      {
        ...key,
        base_target: baseTarget,
        rollover_in: 0,
        effective_target: baseTarget,
        actual: 0,
        achievement_pct: 0
      }
    ],
    session ? { session } : undefined
  );
  return created[0];
}

async function upsertDayTarget({ scopeType, scopeId, metricCode, date, baseTarget, session }) {
  return upsertPeriodTarget({
    scopeType,
    scopeId,
    metricCode,
    periodType: KPI_PERIOD_TYPE.DAY,
    periodKey: dayKey(date),
    baseTarget,
    session
  });
}

async function rollupWeekTarget({ scopeType, scopeId, metricCode, wKey, session }) {
  const { start, end } = weekRange(wKey);

  const query = KpiPeriodTargetModel.find({
    scope_type: scopeType,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: KPI_PERIOD_TYPE.DAY,
    period_key: { $gte: dayKey(start), $lt: dayKey(end) },
    isDeleted: false
  }).select("base_target");
  if (session) query.session(session);
  const dayRows = await query.lean();

  const weekSum = round2(dayRows.reduce((acc, r) => acc + (r.base_target || 0), 0));

  return upsertPeriodTarget({
    scopeType,
    scopeId,
    metricCode,
    periodType: KPI_PERIOD_TYPE.WEEK,
    periodKey: wKey,
    baseTarget: weekSum,
    session
  });
}

async function decomposeAssignment({ assignment, previousItems = [], session = null }) {
  const scopeType = KPI_SCOPE_TYPE.SALE;
  const scopeId = assignment.sale_id;

  const workingDays = await getWorkingDays(assignment.year, assignment.month);
  const touchedWeekKeys = new Set();
  const metricSummaries = [];

  for (const item of assignment.items) {
    const dayTargets = computeDayTargets(item.target, workingDays);
    for (const dt of dayTargets) {
      await upsertDayTarget({
        scopeType,
        scopeId,
        metricCode: item.metric_code,
        date: dt.date,
        baseTarget: dt.base_target,
        session
      });
      touchedWeekKeys.add(weekKey(dt.date));
    }
    metricSummaries.push({ metric_code: item.metric_code, working_days: workingDays.length });
  }

  const newCodes = new Set(assignment.items.map((i) => i.metric_code));
  const removedCodes = previousItems.map((i) => i.metric_code).filter((c) => !newCodes.has(c));

  for (const metricCode of removedCodes) {
    const zeroDayTargets = computeDayTargets(0, workingDays);
    for (const dt of zeroDayTargets) {
      await upsertDayTarget({ scopeType, scopeId, metricCode, date: dt.date, baseTarget: 0, session });
      touchedWeekKeys.add(weekKey(dt.date));
    }
  }

  const allTouchedCodes = new Set([...newCodes, ...removedCodes]);
  const weekSummaries = [];
  for (const wKey of touchedWeekKeys) {
    for (const metricCode of allTouchedCodes) {
      const w = await rollupWeekTarget({ scopeType, scopeId, metricCode, wKey, session });
      weekSummaries.push({ metric_code: metricCode, week_key: wKey, base_target: w.base_target });
    }
  }

  return { metrics: metricSummaries, weeks: weekSummaries };
}

module.exports = {
  getWorkingDays,
  computeDayTargets,
  upsertDayTarget,
  rollupWeekTarget,
  decomposeAssignment
};
