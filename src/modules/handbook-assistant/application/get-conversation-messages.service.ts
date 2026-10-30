import { NotFoundException } from "../../../core/exceptions/exceptions";
import { handbookChatRepository as chatRepo } from "../infrastructure/handbook-chat.repository";
import type { MessageRecord } from "../infrastructure/handbook-chat.repository";

export interface ChatMessageView {
  _id: string;
  role: "user" | "assistant";
  content: string;
  citations: MessageRecord["citations"];
  truncated: boolean;
  status: "done" | "error" | "cancelled";
  errorCode: string | null;
  feedback: 1 | -1 | null;
  createdAt: Date;
}

// Use-case ĐỌC: lịch sử một hội thoại theo thứ tự tăng dần. Hội thoại của người khác và hội thoại
// không tồn tại cùng trả 404. Tin trả lời đang stream bị ẩn (web nhận qua socket).
export async function getConversationMessages(
  accountId: string,
  conversationId: string
): Promise<ChatMessageView[]> {
  const conversation = await chatRepo.findOwnedConversation(conversationId, accountId);
  if (!conversation) throw new NotFoundException("Không tìm thấy hội thoại");

  const messages = await chatRepo.listFinishedMessages(conversationId);
  return messages.map((message) => ({
    _id: message._id,
    role: message.role,
    content: message.content,
    citations: message.citations,
    truncated: message.truncated,
    // Đã loại tin `streaming` ở repository nên chỉ còn 3 trạng thái này.
    status: message.status as ChatMessageView["status"],
    errorCode: message.errorCode,
    feedback: message.feedback,
    createdAt: message.createdAt
  }));
}
