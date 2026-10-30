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
  account: string;
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
  clientId: string | null;
  quotaDateKey: string | null;
  createdAt: Date;
}

export interface FinishUpdate {
  status: "done" | "error" | "cancelled";
  content: string;
  errorCode: string | null;
  citations?: MessageRecord["citations"];
  truncated?: boolean;
  // Câu trả lời hỏng trước khi người dùng nhận được kết quả → lượt hỏi đã được hoàn lại.
  quotaRefunded?: boolean;
  ai?: {
    model: string | null;
    stopReason: string | null;
    usage: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite5m: number;
      cacheWrite1h: number;
    };
    costUsd: number | null;
    ttftMs: number | null;
    latencyMs: number | null;
  };
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
    account: String(doc.account),
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
    clientId: doc.clientId ?? null,
    quotaDateKey: doc.quotaDateKey ?? null,
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

  // Xoá hẳn các hội thoại và toàn bộ tin nhắn của chúng (web hứa "xoá vĩnh viễn"). Gọi trong giao
  // dịch vì ghi vào 2 collection. Trả về số tin đã xoá.
  async deleteConversationsWithMessages(conversationIds: string[]): Promise<number> {
    if (!conversationIds.length) return 0;
    const session = this.session ?? undefined;
    const messages = await HandbookMessageModel.deleteMany(
      { conversation: { $in: conversationIds } },
      { session }
    );
    await HandbookConversationModel.deleteMany({ _id: { $in: conversationIds } }, { session });
    return messages.deletedCount ?? 0;
  }

  async deleteConversationWithMessages(conversationId: string): Promise<number> {
    return this.deleteConversationsWithMessages([conversationId]);
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

  // ---- Luồng hỏi / stream ----

  async insertConversation(input: {
    accountId: string;
    title: string;
    versionId: string;
    now: Date;
  }): Promise<string> {
    const [doc] = await HandbookConversationModel.create(
      [
        {
          account: input.accountId,
          title: input.title,
          version: input.versionId,
          turnCount: 1,
          lastMessageAt: input.now
        }
      ],
      { session: this.session ?? undefined }
    );
    return String(doc._id);
  }

  // Tăng số lượt NGUYÊN TỬ và chỉ khi hội thoại vẫn của tài khoản này, vẫn thuộc phiên bản đang hiệu
  // lực và chưa đạt số lượt tối đa. Trả về null nếu một điều kiện không còn đúng.
  async bumpConversationTurn(input: {
    conversationId: string;
    accountId: string;
    versionId: string;
    maxTurns: number;
    now: Date;
  }): Promise<{ turnCount: number } | null> {
    const doc = await HandbookConversationModel.findOneAndUpdate(
      {
        _id: input.conversationId,
        account: input.accountId,
        version: input.versionId,
        turnCount: { $lt: input.maxTurns }
      },
      { $inc: { turnCount: 1 }, $set: { lastMessageAt: input.now } },
      { new: true, session: this.session ?? undefined }
    ).lean();
    return doc ? { turnCount: doc.turnCount } : null;
  }

  // Tin user (seq lẻ n) + tin trả lời đang `streaming` (seq n+1) của một lượt hỏi.
  async insertTurnMessages(input: {
    conversationId: string;
    accountId: string;
    userSeq: number;
    question: string;
    clientId: string;
    assistantMessageId: string;
    quotaDateKey: string;
    model: string;
  }): Promise<void> {
    await HandbookMessageModel.create(
      [
        {
          conversation: input.conversationId,
          account: input.accountId,
          seq: input.userSeq,
          role: "user",
          content: input.question,
          status: "done",
          clientId: input.clientId
        },
        {
          _id: input.assistantMessageId,
          conversation: input.conversationId,
          account: input.accountId,
          seq: input.userSeq + 1,
          role: "assistant",
          content: "",
          status: "streaming",
          quotaDateKey: input.quotaDateKey,
          ai: { model: input.model }
        }
      ],
      { session: this.session ?? undefined, ordered: true }
    );
  }

  async findUserMessageByClientId(
    accountId: string,
    clientId: string
  ): Promise<MessageRecord | null> {
    const doc = await HandbookMessageModel.findOne({ account: accountId, clientId, role: "user" })
      .session(this.session)
      .lean();
    return doc ? toMessageRecord(doc) : null;
  }

  async findMessageBySeq(conversationId: string, seq: number): Promise<MessageRecord | null> {
    const doc = await HandbookMessageModel.findOne({ conversation: conversationId, seq })
      .session(this.session)
      .lean();
    return doc ? toMessageRecord(doc) : null;
  }

  // ĐIỂM CHỐT duy nhất của một câu trả lời: chỉ ghi được khi tin vẫn đang `streaming`. Cancel, done,
  // watchdog, quét câu treo... đua nhau thì chỉ bên ghi thắng (trả về true) được phát sự kiện/hoàn lượt.
  async finishAnswer(messageId: string, update: FinishUpdate): Promise<boolean> {
    const result = await HandbookMessageModel.updateOne(
      { _id: messageId, status: "streaming" },
      {
        $set: {
          status: update.status,
          content: update.content,
          errorCode: update.errorCode,
          citations: update.citations ?? [],
          truncated: update.truncated ?? false,
          quotaRefunded: update.quotaRefunded ?? false,
          ...(update.ai ? { ai: update.ai } : {})
        }
      },
      { session: this.session ?? undefined }
    );
    return result.matchedCount > 0;
  }

  async touchConversation(conversationId: string, at: Date): Promise<void> {
    await HandbookConversationModel.updateOne(
      { _id: conversationId },
      { $set: { lastMessageAt: at } },
      { session: this.session ?? undefined }
    );
  }

  // Tin trả lời `streaming` quá lâu (tiến trình chết giữa chừng).
  async findStaleStreamingMessages(before: Date, limit: number): Promise<MessageRecord[]> {
    const docs = await HandbookMessageModel.find({
      role: "assistant",
      status: "streaming",
      createdAt: { $lt: before }
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .session(this.session)
      .lean();
    return docs.map(toMessageRecord);
  }

  async findExpiredConversationIds(before: Date, limit: number): Promise<string[]> {
    const docs = await HandbookConversationModel.find({ lastMessageAt: { $lt: before } })
      .sort({ lastMessageAt: 1 })
      .limit(limit)
      .select("_id")
      .session(this.session)
      .lean();
    return docs.map((doc) => String(doc._id));
  }
}

export const handbookChatRepository = new HandbookChatRepository();
