import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Tin nhắn trong hội thoại Trợ lý Nội quy. Owner: module handbook-assistant.
// Lệch có chủ ý khỏi soft delete như HandbookConversationModel (xoá hội thoại = xoá hẳn tin).

export const HANDBOOK_MESSAGE_STATUSES = ["streaming", "done", "error", "cancelled"] as const;
export type HandbookMessageStatus = (typeof HANDBOOK_MESSAGE_STATUSES)[number];

const CitationSchema = new Schema(
  {
    documentCode: { type: String, required: true },
    documentTitle: { type: String, required: true },
    label: { type: String, required: true },
    articleIdx: { type: Number, required: true },
    citedText: { type: String, default: "" }
  },
  { _id: false }
);

const UsageSchema = new Schema(
  {
    input: { type: Number, default: 0 },
    output: { type: Number, default: 0 },
    cacheRead: { type: Number, default: 0 },
    cacheWrite5m: { type: Number, default: 0 },
    cacheWrite1h: { type: Number, default: 0 }
  },
  { _id: false }
);

const AiMetaSchema = new Schema(
  {
    model: { type: String, default: null },
    stopReason: { type: String, default: null },
    usage: { type: UsageSchema, default: undefined },
    costUsd: { type: Number, default: 0 },
    ttftMs: { type: Number, default: null },
    latencyMs: { type: Number, default: null }
  },
  { _id: false }
);

const HandbookMessageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: "handbook_conversation", required: true },
    account: { type: Schema.Types.ObjectId, ref: "account", required: true },
    // Thứ tự trong hội thoại (tin user n, tin trả lời n+1) — không dựa vào createdAt vì cùng giao dịch.
    seq: { type: Number, required: true, min: 1 },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, default: "" },
    status: { type: String, enum: HANDBOOK_MESSAGE_STATUSES, default: "done", required: true },
    errorCode: { type: String, default: null },
    citations: { type: [CitationSchema], default: [] },
    truncated: { type: Boolean, default: false },
    // clientId do web sinh cho mỗi lần hỏi; dùng chống gửi trùng (chỉ gắn trên tin user).
    clientId: { type: String, default: undefined },
    feedback: {
      type: Number,
      default: null,
      validate: {
        validator: (value: number | null) => value === null || value === 1 || value === -1,
        message: "feedback chỉ nhận 1, -1 hoặc null"
      }
    },
    feedbackComment: { type: String, default: null },
    // Ngày (giờ VN) của lượt quota đã giữ cho câu hỏi này + cờ đã hoàn — để hoàn lượt idempotent.
    quotaDateKey: { type: String, default: null },
    quotaRefunded: { type: Boolean, default: false },
    ai: { type: AiMetaSchema, default: undefined },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "handbook_message"
  }
);

HandbookMessageSchema.index({ conversation: 1, seq: 1 }, { unique: true });
HandbookMessageSchema.index({ status: 1, createdAt: 1 });
HandbookMessageSchema.index(
  { account: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } }
);

export default mongoose.model("handbook_message", HandbookMessageSchema);
