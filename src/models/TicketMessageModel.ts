import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Trao đổi giữa người tạo và nhóm xử lý trong ticket. File đính kèm của tin nhắn nằm ở
// ticket_attachment (message_id). Owner: module ticket.

const TicketMessageSchema = new Schema(
  {
    ticket_id: { type: Schema.Types.ObjectId, ref: "ticket", required: true },
    author_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    body: { type: String, default: "" },
    mention_ids: [{ type: Schema.Types.ObjectId, ref: "user_info" }],

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_message"
  }
);

TicketMessageSchema.index({ ticket_id: 1, createdAt: 1 });

export default mongoose.model("ticket_message", TicketMessageSchema);
