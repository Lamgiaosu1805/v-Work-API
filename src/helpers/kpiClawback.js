const KpiPeriodTargetModel = require("../models/KpiPeriodTargetModel");
const { KPI_PERIOD_TYPE } = require("../constants");
const { monthKey, dayKey } = require("./kpiPeriod");

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function resolvePeriodsToApply({ investedAt, saleId, metricCode }) {
  const invested = new Date(investedAt);
  const mKey = monthKey(invested.getFullYear(), invested.getMonth() + 1);
  const dKey = dayKey(invested);
  const yKey = String(invested.getFullYear());

  const monthRecord = await KpiPeriodTargetModel.findOne({
    scope_type: "sale",
    scope_id: saleId,
    metric_code: metricCode,
    period_type: KPI_PERIOD_TYPE.MONTH,
    period_key: mKey,
    isDeleted: false
  })
    .select("is_closed")
    .lean();

  if (monthRecord?.is_closed) {
    return [{ period_type: KPI_PERIOD_TYPE.YEAR, period_key: yKey }];
  }
  return [
    { period_type: KPI_PERIOD_TYPE.DAY, period_key: dKey },
    { period_type: KPI_PERIOD_TYPE.MONTH, period_key: mKey }
  ];
}

async function applyActualDelta({
  scopeType,
  scopeId,
  metricCode,
  periodType,
  periodKey,
  delta,
  session
}) {
  const key = {
    scope_type: scopeType,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: periodType,
    period_key: periodKey
  };

  const existing = await KpiPeriodTargetModel.findOne({ ...key, isDeleted: false }).session(
    session
  );
  if (existing?.is_closed) return null;

  if (existing) {
    existing.actual = (existing.actual || 0) + delta;
    existing.achievement_pct =
      existing.effective_target > 0
        ? round2((existing.actual / existing.effective_target) * 100)
        : 0;
    await existing.save({ session });
    return existing;
  }

  const created = await KpiPeriodTargetModel.create(
    [
      {
        ...key,
        base_target: 0,
        rollover_in: 0,
        effective_target: 0,
        actual: delta,
        achievement_pct: 0
      }
    ],
    { session }
  );
  return created[0];
}

module.exports = { resolvePeriodsToApply, applyActualDelta };
