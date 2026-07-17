const KpiAdjustmentModel = require("../models/KpiAdjustmentModel");
const { getScopeMetrics } = require("../helpers/kpiDashboard");
const { getUserInfoIdFromAccount, getAccountTtkdIds, getSaleInfoIdsInTtkds } = require("../helpers/kpiHelper");
const { KPI_SCOPE_TYPE } = require("../constants");

function validatePeriodQuery(req, res) {
  const { period_type, period_key } = req.query;
  if (!period_type || !period_key) {
    res.status(400).json({ message: "Thiếu tham số bắt buộc: period_type, period_key" });
    return null;
  }
  return { period_type, period_key };
}

const KpiDashboardController = {
  me: async (req, res) => {
    try {
      const period = validatePeriodQuery(req, res);
      if (!period) return;

      const saleId = await getUserInfoIdFromAccount(req.account._id);
      if (!saleId) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });

      const metrics = await getScopeMetrics({
        scopeType: KPI_SCOPE_TYPE.SALE,
        scopeId: saleId,
        periodType: period.period_type,
        periodKey: period.period_key
      });

      const clawbacks = await KpiAdjustmentModel.find({
        sale_id: saleId,
        period_type: period.period_type,
        applied_period_key: period.period_key,
        isDeleted: false
      })
        .select("metric_code amount reason withdrawal_date note")
        .lean();

      return res.status(200).json({
        message: "OK",
        data: { period, metrics, clawbacks }
      });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  },

  team: async (req, res) => {
    try {
      const period = validatePeriodQuery(req, res);
      if (!period) return;

      let ttkdIds;
      if (req.account.role === "admin" && req.query.ttkd_id) {
        ttkdIds = [req.query.ttkd_id];
      } else {
        ttkdIds = await getAccountTtkdIds(req.account._id);
      }
      if (!ttkdIds.length) return res.status(403).json({ message: "Tài khoản không thuộc TTKD nào" });

      const teams = [];
      for (const ttkdId of ttkdIds) {
        const ttkdMetrics = await getScopeMetrics({
          scopeType: KPI_SCOPE_TYPE.TTKD,
          scopeId: ttkdId,
          periodType: period.period_type,
          periodKey: period.period_key
        });

        const saleIds = await getSaleInfoIdsInTtkds([ttkdId]);
        const sales = [];
        for (const saleId of saleIds) {
          const saleMetrics = await getScopeMetrics({
            scopeType: KPI_SCOPE_TYPE.SALE,
            scopeId: saleId,
            periodType: period.period_type,
            periodKey: period.period_key
          });
          sales.push({ sale_id: saleId, metrics: saleMetrics });
        }

        teams.push({ ttkd_id: ttkdId, metrics: ttkdMetrics, sales });
      }

      return res.status(200).json({ message: "OK", data: { period, teams } });
    } catch (err) {
      return res.status(500).json({ message: "Lỗi server", error: err.message });
    }
  }
};

module.exports = KpiDashboardController;
