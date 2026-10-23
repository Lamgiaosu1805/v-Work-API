import moment from "moment-timezone";
import HandbookUsageModel from "../../../models/HandbookUsageModel";
import { DateKey } from "../../../shared-kernel/date-key";
import { getHandbookAssistantConfig } from "./handbook-assistant.config";

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
