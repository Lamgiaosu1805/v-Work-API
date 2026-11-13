import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Hạn mức câu hỏi / ngày (giờ VN) theo tài khoản + agent, kèm cộng dồn token/chi phí để thống kê.
const AgentUsageSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "account", required: true },
    agent_code: { type: String, required: true },
    date_key: { type: String, required: true },
    used: { type: Number, default: 0 },
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    cost_usd: { type: Number, default: 0 },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  } as SchemaOptions
);

AgentUsageSchema.index({ account: 1, agent_code: 1, date_key: 1 }, { unique: true });

export default mongoose.model("agent_usage", AgentUsageSchema);
