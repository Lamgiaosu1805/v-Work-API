import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Mẫu yêu cầu cho các ca hay gặp (reset thiết bị, đổi SĐT...). Là CẤU HÌNH: trường động, giấy tờ, có cần
// tờ trình không, mức khẩn mặc định, người phụ trách, hướng dẫn tự xử lý. Frontend tự dựng form từ đây.
// Owner: module ticket.

const FieldSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ["text", "textarea", "phone", "number", "money", "date", "select"],
      default: "text"
    },
    required: { type: Boolean, default: false },
    placeholder: { type: String, default: "" },
    help: { type: String, default: "" },
    options: [{ type: String }]
  },
  { _id: false }
);

const DocumentSchema = new Schema(
  {
    kind: { type: String, required: true },
    label: { type: String, required: true },
    required: { type: Boolean, default: false },
    sensitive: { type: Boolean, default: false }
  },
  { _id: false }
);

const TicketTemplateSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    category_id: { type: Schema.Types.ObjectId, ref: "ticket_category", required: true },
    // Gợi ý tiêu đề, vd "[{product}] Reset thiết bị – {phone}"; người tạo vẫn sửa được
    title_pattern: { type: String, default: "" },
    fields: [FieldSchema],
    required_documents: [DocumentSchema],
    requires_approval: { type: Boolean, default: false },
    default_urgency: { type: String, enum: ["urgent", "normal", "low"], default: "normal" },
    // Người nhận thông báo khi có ticket Khẩn từ mẫu này (cấp ưu tiên 1, trước loại yêu cầu và mặc định)
    handler_ids: [{ type: Schema.Types.ObjectId, ref: "user_info" }],
    // Hướng dẫn khách tự xử lý — hiện cho người tạo trước khi tạo ticket
    guidance: { type: String, default: "" },
    is_active: { type: Boolean, default: true },
    sort_order: { type: Number, default: 0 },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_template"
  }
);

TicketTemplateSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model("ticket_template", TicketTemplateSchema);
