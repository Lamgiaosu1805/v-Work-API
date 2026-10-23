const cron = require("node-cron");
const crypto = require("crypto");
const redis = require("../config/redis");
const { TicketSweepService } = require("../modules/ticket");

// Ticket hỗ trợ nội bộ — tự đóng ticket quá hạn (đã xử lý không xác nhận / chờ bổ sung không phản hồi)
// và nhắc 1 lần. Chạy mỗi 5 phút. Cảnh báo vàng KHÔNG nằm ở đây (chỉ là mốc alert_at so với giờ hiện tại
// khi đọc). Redis lock có tiền tố môi trường để test/live dùng chung Redis không tranh khoá của nhau, và
// release nguyên tử (chỉ xoá khoá nếu còn đúng token của mình).

const TZ = "Asia/Ho_Chi_Minh";
const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");
const LOCK_KEY = `${ENV_PREFIX}:lock:ticket:sweep`;
const LOCK_TTL_MS = 4 * 60 * 1000;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

async function withLock(key, ttlMs, fn) {
  const token = crypto.randomUUID();
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token);
  }
}

async function runTicketSweep() {
  return withLock(LOCK_KEY, LOCK_TTL_MS, async () => {
    const result = await new TicketSweepService().run();
    if (result.autoClosed || result.reminded) {
      console.log("[Ticket]", JSON.stringify(result));
    }
    return result;
  });
}

function registerTicketSweepJob() {
  cron.schedule(
    "*/5 * * * *",
    () => runTicketSweep().catch((err) => console.error("[Ticket] Lỗi lượt quét:", err)),
    { timezone: TZ }
  );
}

module.exports = { registerTicketSweepJob, runTicketSweep };
