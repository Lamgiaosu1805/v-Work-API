const InvestmentModel = require("../models/InvestmentModel");
const DepartmentModel = require("../models/DepartmentModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const KpiPeriodTargetModel = require("../models/KpiPeriodTargetModel");
const { KPI_AUTO_SOURCE, KPI_SCOPE_TYPE, KPI_PERIOD_TYPE } = require("../constants");
const { monthKey, dayKey, monthRange } = require("./kpiPeriod");

const METRIC = KPI_AUTO_SOURCE.INVESTMENT_REVENUE;

function resolveSourceBucket(commission) {
  if (!commission) return "bld";
  if (commission.status === "none") return "mkt";
  if (commission.receiver_type === "sale") return "cbb";
  return "bld";
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function syncInvestmentRevenue({ year, month, ttkdId = null }) {
  const { start, end } = monthRange(year, month);
  const mKey = monthKey(year, month);

  const branchFilter = { type: "branch", isDeleted: false };
  if (ttkdId) branchFilter._id = ttkdId;
  const branchDepts = await DepartmentModel.find(branchFilter).select("_id").lean();
  const branchIds = branchDepts.map((d) => d._id);
  if (!branchIds.length) {
    return { metric: METRIC, period: mKey, investments_processed: 0, records_updated: 0 };
  }

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
    const key = {
      scope_type: e.scopeType,
      scope_id: e.scopeId,
      metric_code: METRIC,
      period_type: e.periodType,
      period_key: e.periodKey
    };
    const breakdown = { mkt: e.mkt, cbb: e.cbb, bld: e.bld };

    const doc = await KpiPeriodTargetModel.findOne({ ...key, isDeleted: false });
    if (doc) {
      if (doc.is_closed) continue;
      doc.actual = e.total;
      doc.source_breakdown = breakdown;
      doc.achievement_pct =
        doc.effective_target > 0 ? round2((e.total / doc.effective_target) * 100) : 0;
      await doc.save();
    } else {
      await KpiPeriodTargetModel.create({
        ...key,
        base_target: 0,
        rollover_in: 0,
        effective_target: 0,
        actual: e.total,
        achievement_pct: 0,
        source_breakdown: breakdown
      });
    }
    updated++;
  }

  return {
    metric: METRIC,
    period: mKey,
    ttkd_id: ttkdId ? String(ttkdId) : "all",
    investments_processed: processed,
    records_updated: updated
  };
}

module.exports = { syncInvestmentRevenue };
