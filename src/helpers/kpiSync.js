const InvestmentModel = require("../models/InvestmentModel");
const CustomerModel = require("../models/CustomerModel");
const DepartmentModel = require("../models/DepartmentModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const KpiMetricModel = require("../models/KpiMetricModel");
const KpiPeriodTargetModel = require("../models/KpiPeriodTargetModel");
const { KPI_AUTO_SOURCE, KPI_SCOPE_TYPE, KPI_PERIOD_TYPE } = require("../constants");
const { monthKey, dayKey, monthRange } = require("./kpiPeriod");

async function resolveMetricCode(autoSource) {
  const metric = await KpiMetricModel.findOne({
    auto_source: autoSource,
    source: "auto",
    is_active: true,
    isDeleted: false
  })
    .select("code")
    .lean();
  return metric ? metric.code : null;
}

function resolveSourceBucket(commission) {
  if (!commission) return "bld";
  if (commission.status === "none") return "mkt";
  if (commission.receiver_type === "sale") return "cbb";
  return "bld";
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function buildSaleToTtkdMap(ttkdId) {
  const branchFilter = { type: "branch", isDeleted: false };
  if (ttkdId) branchFilter._id = ttkdId;
  const branchDepts = await DepartmentModel.find(branchFilter).select("_id").lean();
  const branchIds = branchDepts.map((d) => d._id);
  if (!branchIds.length) return { branchIds, saleToTtkd: new Map() };

  const udps = await UserDepartmentPositionModel.find({
    department: { $in: branchIds },
    isDeleted: false
  })
    .select("user department")
    .lean();
  const saleToTtkd = new Map();
  for (const u of udps) {
    const k = String(u.user);
    if (!saleToTtkd.has(k)) saleToTtkd.set(k, u.department);
  }
  return { branchIds, saleToTtkd };
}

async function upsertActual({
  scopeType,
  scopeId,
  metricCode,
  periodType,
  periodKey,
  actual,
  breakdown
}) {
  const key = {
    scope_type: scopeType,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: periodType,
    period_key: periodKey
  };

  const doc = await KpiPeriodTargetModel.findOne({ ...key, isDeleted: false });
  if (doc) {
    if (doc.is_closed) return false;
    doc.actual = actual;
    if (breakdown) doc.source_breakdown = breakdown;
    doc.achievement_pct =
      doc.effective_target > 0 ? round2((actual / doc.effective_target) * 100) : 0;
    await doc.save();
  } else {
    await KpiPeriodTargetModel.create({
      ...key,
      base_target: 0,
      rollover_in: 0,
      effective_target: 0,
      actual,
      achievement_pct: 0,
      ...(breakdown ? { source_breakdown: breakdown } : {})
    });
  }
  return true;
}

async function syncInvestmentRevenue({ year, month, ttkdId = null }) {
  const { start, end } = monthRange(year, month);
  const mKey = monthKey(year, month);

  const metricCode = await resolveMetricCode(KPI_AUTO_SOURCE.INVESTMENT_REVENUE);
  if (!metricCode) {
    return { metric: null, period: mKey, investments_processed: 0, records_updated: 0 };
  }

  const { branchIds, saleToTtkd } = await buildSaleToTtkdMap(ttkdId);
  if (!branchIds.length) {
    return { metric: metricCode, period: mKey, investments_processed: 0, records_updated: 0 };
  }

  const investments = await InvestmentModel.find({
    invested_at: { $gte: start, $lt: end },
    "commission.sale_id": { $ne: null },
    isDeleted: false
  })
    .select("amount invested_at commission.sale_id commission.receiver_type commission.status")
    .lean();

  const agg = new Map();
  const bump = (scopeType, scopeId, periodType, periodKey, amount, bucket) => {
    const k = `${scopeType}|${scopeId}|${periodType}|${periodKey}`;
    let e = agg.get(k);
    if (!e) {
      e = { scopeType, scopeId, periodType, periodKey, total: 0, mkt: 0, cbb: 0, bld: 0 };
      agg.set(k, e);
    }
    e.total += amount;
    e[bucket] += amount;
  };

  let processed = 0;
  for (const inv of investments) {
    const saleId = inv.commission.sale_id;
    const ttkd = saleToTtkd.get(String(saleId));
    if (ttkdId && !ttkd) continue;

    const amount = inv.amount || 0;
    const bucket = resolveSourceBucket(inv.commission);
    const dKey = dayKey(inv.invested_at);
    processed++;

    bump(KPI_SCOPE_TYPE.SALE, saleId, KPI_PERIOD_TYPE.MONTH, mKey, amount, bucket);
    bump(KPI_SCOPE_TYPE.SALE, saleId, KPI_PERIOD_TYPE.DAY, dKey, amount, bucket);

    if (ttkd) {
      bump(KPI_SCOPE_TYPE.TTKD, ttkd, KPI_PERIOD_TYPE.MONTH, mKey, amount, bucket);
      bump(KPI_SCOPE_TYPE.TTKD, ttkd, KPI_PERIOD_TYPE.DAY, dKey, amount, bucket);
    }
  }

  let updated = 0;
  for (const e of agg.values()) {
    const wrote = await upsertActual({
      scopeType: e.scopeType,
      scopeId: e.scopeId,
      metricCode,
      periodType: e.periodType,
      periodKey: e.periodKey,
      actual: e.total,
      breakdown: { mkt: e.mkt, cbb: e.cbb, bld: e.bld }
    });
    if (wrote) updated++;
  }

  return {
    metric: metricCode,
    period: mKey,
    ttkd_id: ttkdId ? String(ttkdId) : "all",
    investments_processed: processed,
    records_updated: updated
  };
}

async function syncCifEkyc({ year, month, ttkdId = null }) {
  const { start, end } = monthRange(year, month);
  const mKey = monthKey(year, month);

  const [cifCode, ekycCode] = await Promise.all([
    resolveMetricCode(KPI_AUTO_SOURCE.CIF),
    resolveMetricCode(KPI_AUTO_SOURCE.EKYC)
  ]);
  const metrics = [cifCode, ekycCode].filter(Boolean);
  if (!metrics.length) {
    return { metrics, period: mKey, customers_processed: 0, records_updated: 0 };
  }

  const { branchIds, saleToTtkd } = await buildSaleToTtkdMap(ttkdId);
  if (!branchIds.length) {
    return { metrics, period: mKey, customers_processed: 0, records_updated: 0 };
  }

  const customers = await CustomerModel.find({
    isDeleted: false,
    $or: [
      {
        "cif_commission.sale_id": { $ne: null },
        "cif_commission.granted_at": { $gte: start, $lt: end }
      },
      {
        "ekyc_commission.sale_id": { $ne: null },
        "ekyc_commission.granted_at": { $gte: start, $lt: end }
      }
    ]
  })
    .select("cif_commission ekyc_commission")
    .lean();

  const agg = new Map();
  const bump = (metricCode, scopeType, scopeId, periodType, periodKey) => {
    const k = `${metricCode}|${scopeType}|${scopeId}|${periodType}|${periodKey}`;
    const e = agg.get(k);
    if (e) {
      e.count += 1;
      return;
    }
    agg.set(k, { metricCode, scopeType, scopeId, periodType, periodKey, count: 1 });
  };

  const bumpEvent = (metricCode, saleId, grantedAt) => {
    const ttkd = saleToTtkd.get(String(saleId));
    if (ttkdId && !ttkd) return false;

    const dKey = dayKey(grantedAt);
    bump(metricCode, KPI_SCOPE_TYPE.SALE, saleId, KPI_PERIOD_TYPE.MONTH, mKey);
    bump(metricCode, KPI_SCOPE_TYPE.SALE, saleId, KPI_PERIOD_TYPE.DAY, dKey);
    if (ttkd) {
      bump(metricCode, KPI_SCOPE_TYPE.TTKD, ttkd, KPI_PERIOD_TYPE.MONTH, mKey);
      bump(metricCode, KPI_SCOPE_TYPE.TTKD, ttkd, KPI_PERIOD_TYPE.DAY, dKey);
    }
    return true;
  };

  let processed = 0;
  for (const c of customers) {
    let touched = false;

    const cif = c.cif_commission;
    if (cifCode && cif?.sale_id && cif.granted_at >= start && cif.granted_at < end) {
      touched = bumpEvent(cifCode, cif.sale_id, cif.granted_at) || touched;
    }

    const ekyc = c.ekyc_commission;
    if (ekycCode && ekyc?.sale_id && ekyc.granted_at >= start && ekyc.granted_at < end) {
      touched = bumpEvent(ekycCode, ekyc.sale_id, ekyc.granted_at) || touched;
    }

    if (touched) processed++;
  }

  let updated = 0;
  for (const e of agg.values()) {
    const wrote = await upsertActual({
      scopeType: e.scopeType,
      scopeId: e.scopeId,
      metricCode: e.metricCode,
      periodType: e.periodType,
      periodKey: e.periodKey,
      actual: e.count
    });
    if (wrote) updated++;
  }

  return {
    metrics,
    period: mKey,
    ttkd_id: ttkdId ? String(ttkdId) : "all",
    customers_processed: processed,
    records_updated: updated
  };
}

module.exports = { syncInvestmentRevenue, syncCifEkyc };
