import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Số câu hỏi + token + chi phí ước tính của một tài khoản trong một ngày (giờ VN). Dùng để chặn
// vượt hạn mức và thống kê chi phí. Owner: module handbook-assistant. Giữ lại khi xoá hội thoại.

const HandbookUsageSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "account", required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    used: { type: Number, default: 0, min: 0 },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    cacheWriteTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "handbook_usage"
  }
);

HandbookUsageSchema.index({ account: 1, dateKey: 1 }, { unique: true });
HandbookUsageSchema.index({ dateKey: 1 });

export default mongoose.model("handbook_usage", HandbookUsageSchema);
