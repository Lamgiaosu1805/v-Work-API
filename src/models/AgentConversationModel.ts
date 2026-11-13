import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Hội thoại của agent harness (docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 5) — mỗi hội thoại thuộc 1 agent.
const AgentConversationSchema = new Schema(
  {
    agent_code: { type: String, required: true },
    account: { type: Schema.Types.ObjectId, ref: "account", required: true },
    employee: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    title: { type: String, default: "" },
    message_count: { type: Number, default: 0 },
    last_message_at: { type: Date, default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  } as SchemaOptions
);

AgentConversationSchema.index({ account: 1, agent_code: 1, isDeleted: 1, last_message_at: -1 });

export default mongoose.model("agent_conversation", AgentConversationSchema);
