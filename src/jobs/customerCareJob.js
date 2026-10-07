const cron = require("node-cron");
const crypto = require("crypto");
const redis = require("../config/redis");
const CustomerCarePolicyModel = require("../models/CustomerCarePolicyModel").default;
const { allocateCustomerPool } = require("../workflows/allocate-customer-pool.workflow");
const { sweepCustomerCareSla } = require("../workflows/sweep-customer-care-sla.workflow");
const {
  releaseUnavailableSaleCustomers
} = require("../workflows/release-unavailable-sale-customers.workflow");
const {
  registerCallCareActivityListener
} = require("../workflows/record-call-care-activity.workflow");

// Quy định 183A — phân khách & SLA chăm sóc. Chạy mỗi phút: quét SLA (cảnh báo/thu hồi) rồi phân Pool.
// Redis lock để khi chạy nhiều instance chỉ 1 instance xử lý mỗi lượt.

const TZ = "Asia/Ho_Chi_Minh";
const LOCK_KEY = "lock:customer-care:minute";
const LOCK_TTL_MS = 55 * 1000;

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

async function runMinuteTick(now = new Date()) {
  return withLock(LOCK_KEY, LOCK_TTL_MS, async () => {
    const sweep = await sweepCustomerCareSla(now);
    const policies = await CustomerCarePolicyModel.find({ enabled: true, isDeleted: false })
      .select("app_code")
      .lean();
    const allocations = [];
    for (const policy of policies) {
      allocations.push(await allocateCustomerPool(policy.app_code, now));
    }
    if (sweep.warned || sweep.revoked || allocations.some((a) => a.assigned || a.failed)) {
      console.log("[CustomerCare]", JSON.stringify({ sweep, allocations }));
    }
    return { sweep, allocations };
  });
}

async function runDailyRelease(now = new Date()) {
  return withLock("lock:customer-care:daily", 10 * 60 * 1000, async () => {
    const released = await releaseUnavailableSaleCustomers(now);
    if (released)
      console.log(`[CustomerCare] Thu hồi ${released} khách của Sale nghỉ việc/bị khoá`);
    return released;
  });
}

function registerCustomerCareJobs() {
  registerCallCareActivityListener();
  cron.schedule(
    "* * * * *",
    () => runMinuteTick().catch((err) => console.error("[CustomerCare] Lỗi lượt quét:", err)),
    { timezone: TZ }
  );
  cron.schedule(
    "5 0 * * *",
    () =>
      runDailyRelease().catch((err) => console.error("[CustomerCare] Lỗi thu hồi hằng ngày:", err)),
    { timezone: TZ }
  );
}

module.exports = { registerCustomerCareJobs, runMinuteTick, runDailyRelease };
