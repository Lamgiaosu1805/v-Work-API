import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

export const AGENT_MESSAGE_STATUSES = ["streaming", "done", "error", "cancelled"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

// Nhật ký gọi công cụ (để soát agent đã đọc số liệu nào) — chỉ lưu tên, tham số, thời gian, lỗi; không lưu kết quả.
const ToolCallSchema = new Schema(
  {
    name: { type: String, required: true },
    input: { type: Schema.Types.Mixed, default: {} },
    ok: { type: Boolean, default: true },
    error: { type: String, default: null },
    ms: { type: Number, default: 0 }
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

const AgentMessageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: "agent_conversation", required: true },
    agent_code: { type: String, required: true },
    account: { type: Schema.Types.ObjectId, ref: "account", required: true },
    seq: { type: Number, required: true, min: 1 },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, default: "" },
    status: { type: String, enum: AGENT_MESSAGE_STATUSES, default: "done", required: true },
    error_code: { type: String, default: null },
    tool_calls: { type: [ToolCallSchema], default: [] },
    model: { type: String, default: null },
    stop_reason: { type: String, default: null },
    rounds: { type: Number, default: 0 },
    usage: { type: UsageSchema, default: undefined },
    cost_usd: { type: Number, default: null },
    latency_ms: { type: Number, default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  } as SchemaOptions
);

AgentMessageSchema.index({ conversation: 1, seq: 1 }, { unique: true });
AgentMessageSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.model("agent_message", AgentMessageSchema);
