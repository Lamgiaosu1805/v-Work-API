import { logger } from "../../../config/logger";
import { handbookChatRepository as chatRepo } from "../infrastructure/handbook-chat.repository";
import { getHandbookAssistantConfig } from "./handbook-assistant.config";
import { refundQuota } from "./quota.service";
import { runningAnswers } from "./running-answers.registry";
import type { RunningAnswersRegistry } from "./running-answers.registry";

// Chỉ động tới tin đã `streaming` quá thời gian tối đa của một câu trả lời + khoảng đệm, nên an toàn khi
// deploy (container mới khởi động trong lúc container cũ vẫn đang stream câu còn hạn).
const GRACE_MS = 60_000;
const BATCH = 100;

export interface RecoverStaleOptions {
  now?: Date;
  registry?: RunningAnswersRegistry;
}

// Cron mỗi phút: chốt các câu trả lời bị bỏ rơi (tiến trình chết giữa chừng) thành AI_UNAVAILABLE và
// hoàn lượt. Chốt có điều kiện nên chạy trùng hoặc đua với tiến trình đang sống không gây hại.
export async function recoverStaleAnswers(options: RecoverStaleOptions = {}): Promise<number> {
  const now = options.now ?? new Date();
  const registry = options.registry ?? runningAnswers;
  const { maxDurationMs } = getHandbookAssistantConfig();
  const before = new Date(now.getTime() - maxDurationMs - GRACE_MS);

  const stale = await chatRepo.findStaleStreamingMessages(before, BATCH);
  let recovered = 0;
  for (const message of stale) {
    if (registry.get(message._id)) continue;
    const won = await chatRepo.finishAnswer(message._id, {
      status: "error",
      errorCode: "AI_UNAVAILABLE",
      content: message.content,
      quotaRefunded: true
    });
    if (!won) continue;
    recovered += 1;
    if (message.quotaDateKey) {
      try {
        await refundQuota(message.account, message.quotaDateKey);
      } catch (error) {
        logger.error("Trợ lý Nội quy: không hoàn được lượt hỏi cho câu bị bỏ rơi", {
          messageId: message._id,
          error
        });
      }
    }
  }
  if (recovered) logger.warn("Đã chốt câu trả lời Trợ lý Nội quy bị bỏ rơi", { recovered });
  return recovered;
}
