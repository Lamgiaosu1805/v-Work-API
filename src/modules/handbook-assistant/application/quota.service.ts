import moment from "moment-timezone";
import HandbookUsageModel from "../../../models/HandbookUsageModel";
import { DateKey } from "../../../shared-kernel/date-key";
import { HandbookAssistantError } from "../domain/handbook-assistant.errors";
import { getHandbookAssistantConfig } from "./handbook-assistant.config";
import type { AnswerUsage } from "./ports/handbook-answerer.port";

const APP_TIMEZONE = "Asia/Ho_Chi_Minh";

export interface QuotaView {
  limit: number;
  used: number;
  remaining: number;
  // 00:00 ngày hôm sau (giờ VN) — lúc hạn mức được làm mới (ISO khi serialize JSON).
  resetAt: Date;
}

export function nextQuotaResetAt(now: Date): Date {
  return moment.tz(now, APP_TIMEZONE).add(1, "day").startOf("day").toDate();
}

// Use-case ĐỌC: hạn mức câu hỏi hôm nay của một tài khoản. Chưa hỏi lần nào hôm nay → used = 0.
export async function getQuota(accountId: string, now: Date = new Date()): Promise<QuotaView> {
  const { dailyQuota } = getHandbookAssistantConfig();
  const usage = await HandbookUsageModel.findOne({
    account: accountId,
    dateKey: DateKey.from(now).toString()
  })
    .select("used")
    .lean();
  const used = usage?.used ?? 0;
  return {
    limit: dailyQuota,
    used,
    remaining: Math.max(dailyQuota - used, 0),
    resetAt: nextQuotaResetAt(now)
  };
}

export interface ReservedQuota {
  // Ngày (giờ VN) của lượt đã giữ — hoàn lượt phải trừ đúng ngày này dù đã qua nửa đêm.
  dateKey: string;
}

// Giữ NGUYÊN TỬ một lượt hỏi. Hai bước để không nhầm "đã hết lượt" với "hai yêu cầu đầu ngày tranh
// nhau tạo dòng": (1) upsert chỉ theo khoá bằng ($setOnInsert) — Mongo tự thử lại khi đụng unique
// index; (2) tăng có điều kiện used < limit — không khớp nghĩa là đã hết lượt. Gọi NGOÀI giao dịch
// (lỗi duplicate-key sẽ làm hỏng cả giao dịch).
export async function reserveQuota(
  accountId: string,
  now: Date = new Date()
): Promise<ReservedQuota> {
  const { dailyQuota } = getHandbookAssistantConfig();
  const dateKey = DateKey.from(now).toString();

  await HandbookUsageModel.updateOne(
    { account: accountId, dateKey },
    { $setOnInsert: { used: 0 } },
    { upsert: true }
  );
  const updated = await HandbookUsageModel.findOneAndUpdate(
    { account: accountId, dateKey, used: { $lt: dailyQuota } },
    { $inc: { used: 1 } },
    { new: true }
  ).lean();
  if (!updated) throw new HandbookAssistantError("QUOTA_EXCEEDED");
  return { dateKey };
}

// Trả lại một lượt đã giữ (câu trả lời hỏng trước khi người dùng nhận được kết quả). Không để âm.
export async function refundQuota(accountId: string, dateKey: string): Promise<void> {
  await HandbookUsageModel.updateOne(
    { account: accountId, dateKey, used: { $gt: 0 } },
    { $inc: { used: -1 } }
  );
}

// Cộng dồn token/chi phí của một câu trả lời vào dòng usage của ngày đã giữ lượt (phục vụ thống kê chi
// phí; KHÔNG ảnh hưởng hạn mức).
export async function recordAnswerUsage(
  accountId: string,
  dateKey: string,
  usage: AnswerUsage,
  costUsd: number | null
): Promise<void> {
  await HandbookUsageModel.updateOne(
    { account: accountId, dateKey },
    {
      $inc: {
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite5m + usage.cacheWrite1h,
        costUsd: costUsd ?? 0
      }
    },
    { upsert: true }
  );
}
