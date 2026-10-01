const cron = require("node-cron");
const { reconcileFecLeadCommission } = require("../modules/fec-lead");

const TZ = "Asia/Ho_Chi_Minh";

let isRunning = false;

async function executeReconcile() {
  if (isRunning) {
    console.log("[ReconcileFecLeadCommission] Bỏ qua vì lượt chạy trước chưa xong");
    return;
  }
  isRunning = true;
  try {
    const count = await reconcileFecLeadCommission();
    console.log(
      `[ReconcileFecLeadCommission] Đã rà soát ${count} FecLead COMPLETED chưa tính hoa hồng`
    );
  } catch (err) {
    console.error("[ReconcileFecLeadCommission] Lỗi khi rà soát:", err);
  } finally {
    isRunning = false;
  }
}

function registerReconcileFecLeadCommissionJob() {
  cron.schedule("*/30 * * * *", executeReconcile, { timezone: TZ });
}

module.exports = { registerReconcileFecLeadCommissionJob, executeReconcile };
