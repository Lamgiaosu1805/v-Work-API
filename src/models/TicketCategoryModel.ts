import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Loại yêu cầu (lỗi/sự cố, hỗ trợ tài khoản khách, giao dịch & lãi...). Owner: module ticket.

const TicketCategorySchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    // Người nhận thông báo khi có ticket mới của loại này (mọi mức khẩn; cộng dồn với mẫu và sản phẩm)
    handler_ids: [{ type: Schema.Types.ObjectId, ref: "user_info" }],
    is_active: { type: Boolean, default: true },

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
