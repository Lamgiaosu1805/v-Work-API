const cron = require("node-cron");
const crypto = require("crypto");
const redis = require("../config/redis");
const { syncInvestmentClosures } = require("../workflows/investment-closure-sync.workflow");

// 01:30 hằng đêm — đồng bộ tất toán / tái tục từ danh mục đầu tư TIKLUY cho khách còn khoản chưa tất toán
// (tiền ra, tăng net, AUM, tỷ lệ tái tục). Xem docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 3.
// Khoá Redis có tiền tố môi trường để chỉ 1 instance chạy, test/live dùng chung Redis không chặn nhau.

const TZ = "Asia/Ho_Chi_Minh";
const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");
const LOCK_KEY = `${ENV_PREFIX}:lock:investment-closure-sync`;
const LOCK_TTL_MS = 2 * 60 * 60 * 1000;
const APP_CODES = ["tikluy"];

async function withLock(key, ttlMs, fn) {
  const token = crypto.randomUUID();
  const ok = await redis.set(key, token, "PX", ttlMs, "NX");
  if (!ok) return null;
  try {
    return await fn();
  } finally {
    const current = await redis.get(key);
    if (current === token) await redis.del(key);
  }
}

async function runInvestmentClosureSync(now = new Date()) {
  return withLock(LOCK_KEY, LOCK_TTL_MS, async () => {
    for (const appCode of APP_CODES) {
      const result = await syncInvestmentClosures({ appCode, now });
      console.log(
        `[Investment closure] ${appCode}: ${result.synced}/${result.customers} khách, tất toán ${result.closed}, ` +
          `tái tục ${result.renewed} (nối ${result.renewalLinks}), mã lạ ${result.unknownCodes}, lỗi ${result.errors.length}`
      );
    }
  });
}

function registerInvestmentClosureSyncJob() {
  cron.schedule(
    "30 1 * * *",
    async () => {
      try {
        await runInvestmentClosureSync();
      } catch (error) {
        console.error("[Investment closure] Lỗi đồng bộ:", error.message);
      }
    },
    { timezone: TZ }
  );
}

module.exports = { registerInvestmentClosureSyncJob, runInvestmentClosureSync };
