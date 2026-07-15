const cron = require("node-cron");
const { runDailyRollover } = require("../helpers/kpiRollover");

function registerKpiRolloverJob() {
  cron.schedule(
    "59 23 * * *",
    async () => {
      console.log("[KpiRollover] Bắt đầu tính rollover chỉ tiêu ngày...");
      try {
        const summary = await runDailyRollover({ date: new Date() });
        console.log(
          `[KpiRollover] Hoàn tất: ${summary.processed} bản ghi, ${summary.updated} cập nhật, ${summary.skipped} bỏ qua (kỳ sau đã đóng)`
        );
      } catch (err) {
        console.log("[KpiRollover] Lỗi:", err.message);
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  );
}

module.exports = { registerKpiRolloverJob };
