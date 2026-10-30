import { runInTransaction } from "../../../core/db/run-in-transaction";
import { logger } from "../../../config/logger";
import { handbookChatRepository as chatRepo } from "../infrastructure/handbook-chat.repository";
import { getHandbookAssistantConfig } from "./handbook-assistant.config";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;
// Chặn vòng lặp vô hạn nếu có lỗi bất thường; mỗi lần chạy cron xoá tối đa chừng này lô.
const MAX_BATCHES = 50;

// Cron hằng đêm: xoá HẲN hội thoại (kèm tin nhắn và đánh giá) không hoạt động quá `retentionDays`.
// Số liệu dùng theo ngày (handbook_usage) được giữ lại.
export async function purgeExpiredConversations(now: Date = new Date()): Promise<number> {
  const { retentionDays } = getHandbookAssistantConfig();
  const before = new Date(now.getTime() - retentionDays * DAY_MS);

  let purged = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const ids = await chatRepo.findExpiredConversationIds(before, BATCH);
    if (!ids.length) break;
    await runInTransaction(async () => {
      await chatRepo.deleteConversationsWithMessages(ids);
    });
    purged += ids.length;
  }
  if (purged) logger.info("Đã xoá hội thoại Trợ lý Nội quy hết hạn lưu", { purged, retentionDays });
  return purged;
}
