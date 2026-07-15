const cron = require("node-cron");
const { syncInvestmentRevenue, syncCifEkyc } = require("../helpers/kpiSync");

function registerKpiSyncJob() {
  cron.schedule(
    "30 23 * * *",
    async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      console.log(`[KpiSync] Bắt đầu đồng bộ investment_revenue, cif, ekyc ${year}-${month}...`);
      try {
        const revenueSummary = await syncInvestmentRevenue({ year, month, ttkdId: null });
        console.log(
          `[KpiSync] investment_revenue: ${revenueSummary.investments_processed} đầu tư → ${revenueSummary.records_updated} bản ghi`
        );
        const cifEkycSummary = await syncCifEkyc({ year, month, ttkdId: null });
        console.log(
          `[KpiSync] cif/ekyc: ${cifEkycSummary.customers_processed} khách hàng → ${cifEkycSummary.records_updated} bản ghi`
        );
      } catch (err) {
        console.log("[KpiSync] Lỗi:", err.message);
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  );
}

module.exports = { registerKpiSyncJob };
