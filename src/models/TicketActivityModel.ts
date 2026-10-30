import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Lịch sử thao tác ticket — CHỈ GHI THÊM, không sửa/xoá. Cũng là nhật ký thao tác duy nhất cho các việc
// IT làm trên CMS VNFITE/TIKLUY (CMS không ghi ai đã reset mật khẩu/thiết bị...). Owner: module ticket.

const TicketActivitySchema = new Schema(
  {
    ticket_id: { type: Schema.Types.ObjectId, ref: "ticket", required: true },
    // null = hệ thống (tự đóng, cron)
    actor_id: { type: Schema.Types.ObjectId, ref: "user_info", default: null },
    action: { type: String, required: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
    changes: { type: [Schema.Types.Mixed], default: [] },
    note: { type: String, default: "" },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_activity"
  }
);

TicketActivitySchema.index({ ticket_id: 1, createdAt: 1 });

export default mongoose.model("ticket_activity", TicketActivitySchema);
