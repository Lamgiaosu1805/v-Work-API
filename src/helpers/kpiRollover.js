const KpiPeriodTargetModel = require("../models/KpiPeriodTargetModel");
const { KPI_PERIOD_TYPE, KPI_SCOPE_TYPE } = require("../constants");
const { dayKey, weekKey } = require("./kpiPeriod");
const { rollupWeekTarget, rollupMonthTarget } = require("./kpiDecompose");

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function runDailyRollover({ date = new Date(), closedBy = null } = {}) {
  const todayKey = dayKey(date);
  const tomorrowDate = new Date(date);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowKey = dayKey(tomorrowDate);

  const todayRecords = await KpiPeriodTargetModel.find({
    scope_type: KPI_SCOPE_TYPE.SALE,
    period_type: KPI_PERIOD_TYPE.DAY,
    period_key: todayKey,
    isDeleted: false
  });

  let updated = 0;
  let skipped = 0;
  const touched = new Map();

  for (const record of todayRecords) {
    const shortfall = Math.max(0, round2(record.effective_target - record.actual));

    const tomorrow = await KpiPeriodTargetModel.findOne({
      scope_type: KPI_SCOPE_TYPE.SALE,
      scope_id: record.scope_id,
      metric_code: record.metric_code,
      period_type: KPI_PERIOD_TYPE.DAY,
      period_key: tomorrowKey,
      isDeleted: false
    });

    if (tomorrow?.is_closed) {
      skipped++;
    } else if (tomorrow) {
      tomorrow.rollover_in = shortfall;
      tomorrow.effective_target = round2(tomorrow.base_target + shortfall);
      tomorrow.achievement_pct =
        tomorrow.effective_target > 0
          ? round2((tomorrow.actual / tomorrow.effective_target) * 100)
          : 0;
      await tomorrow.save();
      updated++;
      touched.set(`${record.scope_id}:${record.metric_code}`, {
        scopeId: record.scope_id,
        metricCode: record.metric_code
      });
    } else {
      await KpiPeriodTargetModel.create({
        scope_type: KPI_SCOPE_TYPE.SALE,
        scope_id: record.scope_id,
        metric_code: record.metric_code,
        period_type: KPI_PERIOD_TYPE.DAY,
        period_key: tomorrowKey,
        base_target: 0,
        rollover_in: shortfall,
        effective_target: shortfall,
        actual: 0,
        achievement_pct: 0
      });
      updated++;
      touched.set(`${record.scope_id}:${record.metric_code}`, {
        scopeId: record.scope_id,
        metricCode: record.metric_code
      });
    }

    record.is_closed = true;
    record.closed_at = new Date();
    record.closed_by = closedBy;
    await record.save();
  }

  const wKey = weekKey(tomorrowDate);
  const tomorrowYear = tomorrowDate.getFullYear();
  const tomorrowMonth = tomorrowDate.getMonth() + 1;

  for (const { scopeId, metricCode } of touched.values()) {
    await rollupWeekTarget({ scopeType: KPI_SCOPE_TYPE.SALE, scopeId, metricCode, wKey });
    await rollupMonthTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      metricCode,
      year: tomorrowYear,
      month: tomorrowMonth
    });
  }

  return { processed: todayRecords.length, updated, skipped, closed: todayRecords.length };
}

module.exports = { runDailyRollover };
