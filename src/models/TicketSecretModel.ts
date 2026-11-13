import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Nội dung ẩn (mật khẩu, mã OTP...) người dùng gõ trong trao đổi / bổ sung thông tin của ticket. Văn bản tin nhắn chỉ giữ
// dấu hiệu `⟦s:<_id>⟧`; giá trị thật nằm ở đây, MÃ HOÁ AES-256-GCM (khoá TICKET_SECRET_KEY, ràng với ticket_id). Không
// bao giờ trả giá trị trong API chi tiết — chỉ endpoint "hiện" mới giải mã, sau khi kiểm quyền. Owner: module ticket.

const TicketSecretSchema = new Schema(
  {
    ticket_id: { type: Schema.Types.ObjectId, ref: "ticket", required: true },
    // Tin nhắn chứa nội dung ẩn; để trống khi nội dung ẩn nằm trong ô ghi chú của một thao tác (hoàn thành, đóng, huỷ...)
    message_id: { type: Schema.Types.ObjectId, ref: "ticket_message", default: null },
    author_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    // Nhãn người gõ đặt ("Mật khẩu VPS") — KHÔNG mã hoá, ai thấy ticket cũng thấy; đừng ghi giá trị vào nhãn.
    label: { type: String, default: "" },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    cipher: { type: String, required: true },
    // Nhật ký người đã bấm "Hiện" (giữ 50 lần gần nhất)
    reveals: [
      {
        _id: false,
        by: { type: Schema.Types.ObjectId, ref: "user_info" },
        at: { type: Date }
      }
    ],

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_secret"
  }
);

TicketSecretSchema.index({ ticket_id: 1, message_id: 1 });

export default mongoose.model("ticket_secret", TicketSecretSchema);
