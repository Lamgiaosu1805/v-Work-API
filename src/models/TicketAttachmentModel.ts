import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// File đính kèm của ticket (ảnh lỗi, CCCD, chứng từ, tờ trình...). Owner: module ticket.
// File nhạy cảm (sensitive) chỉ người có quyền mới mở được — xem domain/ticket-access.ts.

const TicketAttachmentSchema = new Schema(
  {
    ticket_id: { type: Schema.Types.ObjectId, ref: "ticket", required: true },
    message_id: { type: Schema.Types.ObjectId, ref: "ticket_message", default: null },
    // Loại giấy tờ do mẫu/checklist đặt, vd "approval_document", "cccd", "screenshot"
    kind: { type: String, default: "other" },
    sensitive: { type: Boolean, default: false },
    original_name: { type: String, required: true },
    // Tên file lưu đĩa trong TICKET_DIR: {timestamp}-{random}{ext}
    stored_name: { type: String, required: true },
    mime_type: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    uploaded_by: { type: Schema.Types.ObjectId, ref: "user_info", required: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_attachment"
  }
);

TicketAttachmentSchema.index({ ticket_id: 1, createdAt: 1 });

export default mongoose.model("ticket_attachment", TicketAttachmentSchema);
