import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Loại yêu cầu (lỗi/sự cố, hỗ trợ tài khoản khách, giao dịch & lãi...). Owner: module ticket.

const TicketCategorySchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    // Người nhận thông báo ticket Khẩn của loại này (cấp ưu tiên 2, sau mẫu yêu cầu)
    handler_ids: [{ type: Schema.Types.ObjectId, ref: "user_info" }],
    is_active: { type: Boolean, default: true },
    sort_order: { type: Number, default: 0 },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_category"
  }
);

TicketCategorySchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model("ticket_category", TicketCategorySchema);
