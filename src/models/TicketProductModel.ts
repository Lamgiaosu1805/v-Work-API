import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Sản phẩm hỗ trợ (VNFITE APP/CMS, TIKLUY APP/CMS, CRM, HRM, Workplace...) — dữ liệu cấu hình, thêm sản
// phẩm mới không cần sửa code. Owner: module ticket.

const TicketProductSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    // Nhóm cha để lọc chung (vd "VNFITE", "TIKLUY", "vWork")
    group: { type: String, default: "" },
    // Liên kết app của CRM (customer.app) để tra khách; null với sản phẩm nội bộ vWork
    app_code: { type: String, default: null },
    description: { type: String, default: "" },
    is_active: { type: Boolean, default: true },
    sort_order: { type: Number, default: 0 },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_product"
  }
);

TicketProductSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model("ticket_product", TicketProductSchema);
