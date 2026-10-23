import { runInTransaction } from "../../../core/db/run-in-transaction";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { logger } from "../../../config/logger";
import { handbookChatRepository as chatRepo } from "../infrastructure/handbook-chat.repository";

// Xoá HẲN hội thoại cùng toàn bộ tin nhắn và đánh giá của nó (giao diện hứa "xoá vĩnh viễn, không
// thể khôi phục"); số liệu dùng theo ngày (`handbook_usage`) được giữ lại. Ghi vào 2 collection nên
// chạy trong giao dịch. Hội thoại của người khác / không tồn tại → 404, không xoá gì.
export async function deleteConversation(accountId: string, conversationId: string): Promise<void> {
  const deletedMessages = await runInTransaction(async () => {
    const conversation = await chatRepo.findOwnedConversation(conversationId, accountId);
    if (!conversation) throw new NotFoundException("Không tìm thấy hội thoại");
    return chatRepo.deleteConversationWithMessages(conversationId);
  });
  logger.info("Đã xoá hội thoại Trợ lý Nội quy", { conversationId, deletedMessages });
}
