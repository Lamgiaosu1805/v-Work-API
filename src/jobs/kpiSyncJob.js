const cron = require("node-cron");
const { syncInvestmentRevenue } = require("../helpers/kpiSync");

function registerKpiSyncJob() {
  cron.schedule(
    "30 23 * * *",
    async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      console.log(`[KpiSync] Bắt đầu đồng bộ investment_revenue ${year}-${month}...`);
      try {
        const summary = await syncInvestmentRevenue({ year, month, ttkdId: null });
        console.log(
          `[KpiSync] Hoàn tất: ${summary.investments_processed} đầu tư → ${summary.records_updated} bản ghi`
        );
      } catch (err) {
        console.log("[KpiSync] Lỗi:", err.message);
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  );
}

module.exports = { registerKpiSyncJob };
