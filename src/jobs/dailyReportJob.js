const cron = require("node-cron");
const crypto = require("crypto");
const redis = require("../config/redis");
const { sendToAccount } = require("../helpers/pushNotification");
const { listDailyReportReminderAccounts } = require("../workflows/daily-report-board.workflow");

// Báo cáo ngày kinh doanh — nhắc nộp kế hoạch 08:45 và kết quả 16:30, thứ Hai → thứ Bảy
// (bỏ qua ngày lễ / nghỉ cả ngày có đơn duyệt). Xem docs/CRM-DAILY-REPORT-FLOWS.md mục 5.
// Redis lock để khi chạy nhiều instance chỉ 1 instance gửi; key có tiền tố môi trường vì test/live có thể dùng chung Redis.

const TZ = "Asia/Ho_Chi_Minh";
const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");
const LOCK_TTL_MS = 10 * 60 * 1000;

const MESSAGES = {
  plan: { title: "Báo cáo ngày", body: "Bạn chưa nộp kế hoạch ngày hôm nay — hạn 09:30." },
  result: { title: "Báo cáo ngày", body: "Bạn chưa nộp kết quả ngày hôm nay — hạn 17:30." }
};

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

async function remindDailyReport(kind, now = new Date()) {
  return withLock(`${ENV_PREFIX}:lock:daily-report:remind:${kind}`, LOCK_TTL_MS, async () => {
    const accountIds = await listDailyReportReminderAccounts({ kind, now });
    const { title, body } = MESSAGES[kind];
    const results = await Promise.allSettled(
      accountIds.map((account_id) =>
        sendToAccount({ account_id, title, body, data: { type: "daily_report_reminder", kind } })
      )
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`[Daily Report] Nhắc ${kind}: ${accountIds.length} người, lỗi gửi ${failed}`);
    return accountIds.length;
  });
}

function registerDailyReportJobs() {
  const schedule = (expression, kind) =>
    cron.schedule(
      expression,
      async () => {
        try {
          await remindDailyReport(kind);
        } catch (error) {
          console.error(`[Daily Report] Lỗi nhắc ${kind}:`, error.message);
        }
      },
      { timezone: TZ }
    );

  schedule("45 8 * * 1-6", "plan");
  schedule("30 16 * * 1-6", "result");
}

module.exports = { registerDailyReportJobs, remindDailyReport };
