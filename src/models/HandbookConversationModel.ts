import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Hội thoại của một tài khoản với Trợ lý Nội quy. Owner: module handbook-assistant.
// Lệch có chủ ý khỏi quy ước soft delete: xoá hội thoại là xoá hẳn (giao diện hứa "không thể khôi
// phục"), nên `isDeleted` của BaseSchema không được dùng ở collection này.

const HandbookConversationSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "account", required: true },
    title: { type: String, default: "" },
    version: { type: Schema.Types.ObjectId, ref: "handbook_version", required: true },
    turnCount: { type: Number, default: 0, min: 0 },
    lastMessageAt: { type: Date, required: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "handbook_conversation"
  }
);

HandbookConversationSchema.index({ account: 1, lastMessageAt: -1 });
HandbookConversationSchema.index({ lastMessageAt: 1 });

export default mongoose.model("handbook_conversation", HandbookConversationSchema);
