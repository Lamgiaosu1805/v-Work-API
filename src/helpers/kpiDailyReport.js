const { applyActualDelta } = require("./kpiClawback");
const { dayKey, monthKey } = require("./kpiPeriod");
const { KPI_SCOPE_TYPE, KPI_PERIOD_TYPE } = require("../constants");

function diffItems(oldItems, newItems) {
  const values = new Map();
  for (const i of oldItems) values.set(i.metric_code, { old: i.value, new: 0 });
  for (const i of newItems) {
    const entry = values.get(i.metric_code) || { old: 0, new: 0 };
    entry.new = i.value;
    values.set(i.metric_code, entry);
  }

  const diffs = [];
  for (const [metric_code, { old: oldValue, new: newValue }] of values) {
    const delta = newValue - oldValue;
    if (delta !== 0) diffs.push({ metric_code, delta });
  }
  return diffs;
}

async function applyReportDelta({ saleId, ttkdId, date, deltaItems, session }) {
  const dKey = dayKey(date);
  const mKey = monthKey(date.getFullYear(), date.getMonth() + 1);

  const applied = [];
  const skipped = [];

  for (const { metric_code, delta } of deltaItems) {
    const targets = [
      { scopeType: KPI_SCOPE_TYPE.SALE, scopeId: saleId, periodType: KPI_PERIOD_TYPE.DAY, periodKey: dKey },
      { scopeType: KPI_SCOPE_TYPE.SALE, scopeId: saleId, periodType: KPI_PERIOD_TYPE.MONTH, periodKey: mKey },
      { scopeType: KPI_SCOPE_TYPE.TTKD, scopeId: ttkdId, periodType: KPI_PERIOD_TYPE.DAY, periodKey: dKey },
      { scopeType: KPI_SCOPE_TYPE.TTKD, scopeId: ttkdId, periodType: KPI_PERIOD_TYPE.MONTH, periodKey: mKey }
    ];

    for (const t of targets) {
      const result = await applyActualDelta({
        scopeType: t.scopeType,
        scopeId: t.scopeId,
        metricCode: metric_code,
        periodType: t.periodType,
        periodKey: t.periodKey,
        delta,
        session
      });
      const entry = { metric_code, ...t, delta };
      if (result) applied.push(entry);
      else skipped.push(entry);
    }
  }

  return { applied, skipped };
}

module.exports = { diffItems, applyReportDelta };
