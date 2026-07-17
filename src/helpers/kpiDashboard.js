const KpiPeriodTargetModel = require("../models/KpiPeriodTargetModel");
const KpiMetricModel = require("../models/KpiMetricModel");
const { KPI_PERIOD_TYPE } = require("../constants");
const { quarterMonths, yearMonths } = require("./kpiPeriod");

function round2(n) {
  return Math.round(n * 100) / 100;
}

function emptySnapshot() {
  return {
    base_target: 0,
    rollover_in: 0,
    effective_target: 0,
    actual: 0,
    achievement_pct: 0,
    source_breakdown: { mkt: 0, cbb: 0, bld: 0 },
    is_closed: false,
    aggregated: false
  };
}

async function getPeriodSnapshot({ scopeType, scopeId, metricCode, periodType, periodKey }) {
  if (periodType === KPI_PERIOD_TYPE.QUARTER || periodType === KPI_PERIOD_TYPE.YEAR) {
    const monthKeys =
      periodType === KPI_PERIOD_TYPE.QUARTER ? quarterMonths(periodKey) : yearMonths(periodKey);

    const rows = await KpiPeriodTargetModel.find({
      scope_type: scopeType,
      scope_id: scopeId,
      metric_code: metricCode,
      period_type: KPI_PERIOD_TYPE.MONTH,
      period_key: { $in: monthKeys },
      isDeleted: false
    })
      .select("base_target rollover_in effective_target actual source_breakdown")
      .lean();

    const snapshot = emptySnapshot();
    snapshot.aggregated = true;
    for (const r of rows) {
      snapshot.base_target += r.base_target || 0;
      snapshot.rollover_in += r.rollover_in || 0;
      snapshot.effective_target += r.effective_target || 0;
      snapshot.actual += r.actual || 0;
      snapshot.source_breakdown.mkt += r.source_breakdown?.mkt || 0;
      snapshot.source_breakdown.cbb += r.source_breakdown?.cbb || 0;
      snapshot.source_breakdown.bld += r.source_breakdown?.bld || 0;
    }
    snapshot.base_target = round2(snapshot.base_target);
    snapshot.rollover_in = round2(snapshot.rollover_in);
    snapshot.effective_target = round2(snapshot.effective_target);
    snapshot.actual = round2(snapshot.actual);
    snapshot.achievement_pct =
      snapshot.effective_target > 0 ? round2((snapshot.actual / snapshot.effective_target) * 100) : 0;
    return snapshot;
  }

  const doc = await KpiPeriodTargetModel.findOne({
    scope_type: scopeType,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: periodType,
    period_key: periodKey,
    isDeleted: false
  })
    .select("base_target rollover_in effective_target actual achievement_pct source_breakdown is_closed")
    .lean();

  if (!doc) return emptySnapshot();

  return {
    base_target: doc.base_target || 0,
    rollover_in: doc.rollover_in || 0,
    effective_target: doc.effective_target || 0,
    actual: doc.actual || 0,
    achievement_pct: doc.achievement_pct || 0,
    source_breakdown: doc.source_breakdown || { mkt: 0, cbb: 0, bld: 0 },
    is_closed: !!doc.is_closed,
    aggregated: false
  };
}

async function getScopeMetrics({ scopeType, scopeId, periodType, periodKey }) {
  const metrics = await KpiMetricModel.find({ is_active: true, isDeleted: false })
    .select("code name group unit source")
    .sort({ order: 1 })
    .lean();

  const result = [];
  for (const metric of metrics) {
    const snapshot = await getPeriodSnapshot({
      scopeType,
      scopeId,
      metricCode: metric.code,
      periodType,
      periodKey
    });
    result.push({
      metric_code: metric.code,
      metric_name: metric.name,
      group: metric.group,
      unit: metric.unit,
      source: metric.source,
      ...snapshot
    });
  }
  return result;
}

module.exports = { getPeriodSnapshot, getScopeMetrics };
