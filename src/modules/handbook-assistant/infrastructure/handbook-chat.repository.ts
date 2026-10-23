import { ClientSession } from "mongoose";
import { RequestContextService } from "../../../core/context/request-context";
import HandbookConversationModel from "../../../models/HandbookConversationModel";
import HandbookMessageModel from "../../../models/HandbookMessageModel";
import type { HandbookMessageStatus } from "../../../models/HandbookMessageModel";

// Truy cập hội thoại/tin nhắn cho các API đọc + thao tác đơn giản (xoá, đánh giá). Mọi hàm đều
// lọc theo `account` để một tài khoản không bao giờ chạm được dữ liệu của người khác — chủ sở hữu
// không khớp trả về null như "không tồn tại" (không lộ việc hội thoại đó có thật).

export interface ConversationRecord {
  _id: string;
  title: string;
  version: string;
  turnCount: number;
  lastMessageAt: Date;
}

export interface MessageRecord {
  _id: string;
  conversation: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  status: HandbookMessageStatus;
  errorCode: string | null;
  citations: Array<{
    documentCode: string;
    documentTitle: string;
    label: string;
    articleIdx: number;
    citedText: string;
  }>;
  truncated: boolean;
  feedback: 1 | -1 | null;
  createdAt: Date;
}

function toConversationRecord(doc: Record<string, any>): ConversationRecord {
  return {
    _id: String(doc._id),
    title: doc.title ?? "",
    version: String(doc.version),
    turnCount: doc.turnCount ?? 0,
    lastMessageAt: doc.lastMessageAt
  };
}

function toMessageRecord(doc: Record<string, any>): MessageRecord {
  return {
    _id: String(doc._id),
    conversation: String(doc.conversation),
    seq: doc.seq,
    role: doc.role,
    content: doc.content ?? "",
    status: doc.status,
    errorCode: doc.errorCode ?? null,
    citations: (doc.citations ?? []).map((c: Record<string, any>) => ({
      documentCode: c.documentCode,
      documentTitle: c.documentTitle,
      label: c.label,
      articleIdx: c.articleIdx,
      citedText: c.citedText ?? ""
    })),
    truncated: Boolean(doc.truncated),
    feedback: doc.feedback ?? null,
    createdAt: doc.createdAt
  };
}

export class HandbookChatRepository {
  // eslint-disable-next-line class-methods-use-this
  private get session(): ClientSession | null {
    return (RequestContextService.getTransactionSession() as ClientSession | undefined) ?? null;
  }

  async listConversations(accountId: string, limit: number): Promise<ConversationRecord[]> {
    const docs = await HandbookConversationModel.find({ account: accountId })
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(limit)
      .session(this.session)
      .lean();
    return docs.map(toConversationRecord);
  }

  async findOwnedConversation(
    conversationId: string,
    accountId: string
  ): Promise<ConversationRecord | null> {
    const doc = await HandbookConversationModel.findOne({ _id: conversationId, account: accountId })
      .session(this.session)
      .lean();
    return doc ? toConversationRecord(doc) : null;
  }

  // Tin đã có kết quả, theo thứ tự trong hội thoại. Tin trả lời đang `streaming` bị ẩn.
  async listFinishedMessages(conversationId: string): Promise<MessageRecord[]> {
    const docs = await HandbookMessageModel.find({
      conversation: conversationId,
      status: { $ne: "streaming" }
    })
      .sort({ seq: 1 })
      .session(this.session)
      .lean();
    return docs.map(toMessageRecord);
  }

  async findOwnedMessage(messageId: string, accountId: string): Promise<MessageRecord | null> {
    const doc = await HandbookMessageModel.findOne({ _id: messageId, account: accountId })
      .session(this.session)
      .lean();
    return doc ? toMessageRecord(doc) : null;
  }

  // Xoá hẳn hội thoại và toàn bộ tin nhắn (web hứa "xoá vĩnh viễn"). Gọi trong giao dịch vì ghi
  // vào 2 collection. Trả về số tin đã xoá.
  async deleteConversationWithMessages(conversationId: string): Promise<number> {
    const session = this.session ?? undefined;
    const messages = await HandbookMessageModel.deleteMany(
      { conversation: conversationId },
      { session }
    );
    await HandbookConversationModel.deleteOne({ _id: conversationId }, { session });
    return messages.deletedCount ?? 0;
  }

  // Ghi đánh giá nguyên tử bằng update dạng pipeline để 2 lần gọi gần như đồng thời (👎 rồi 👎 kèm
  // góp ý) không ghi đè lẫn nhau:
  //  - có góp ý → ghi góp ý;
  //  - không góp ý + đổi chiều đánh giá → xoá góp ý cũ (không còn đúng với đánh giá mới);
  //  - không góp ý + cùng chiều → giữ nguyên góp ý đang có.
  async setFeedback(
    messageId: string,
    accountId: string,
    value: 1 | -1,
    comment: string | null
  ): Promise<boolean> {
    const commentExpression =
      comment !== null
        ? comment
        : { $cond: [{ $eq: ["$feedback", value] }, "$feedbackComment", null] };
    const result = await HandbookMessageModel.updateOne(
      { _id: messageId, account: accountId, role: "assistant", status: { $ne: "streaming" } },
      [{ $set: { feedback: value, feedbackComment: commentExpression } }],
      { session: this.session ?? undefined }
    );
    return result.matchedCount > 0;
  }
}

export const handbookChatRepository = new HandbookChatRepository();
