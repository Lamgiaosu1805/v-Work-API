import { handbookChatRepository as chatRepo } from "../infrastructure/handbook-chat.repository";

// Danh sách hội thoại không phân trang (web không phân trang) nên chặn ở mức hợp lý.
export const MAX_LISTED_CONVERSATIONS = 100;

export interface ConversationSummaryView {
  _id: string;
  title: string;
  // Thời điểm có tin mới nhất (ISO khi serialize JSON) — web sắp xếp/hiển thị "x phút trước".
  updatedAt: Date;
}

// Use-case ĐỌC (CQRS-lite): chỉ hội thoại của chính tài khoản, mới nhất trước.
export async function listConversations(accountId: string): Promise<ConversationSummaryView[]> {
  const conversations = await chatRepo.listConversations(accountId, MAX_LISTED_CONVERSATIONS);
  return conversations.map((conversation) => ({
    _id: conversation._id,
    title: conversation.title,
    updatedAt: conversation.lastMessageAt
  }));
}
