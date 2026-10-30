import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Cấu hình chung của ticket: người phụ trách mặc định, ngưỡng cảnh báo vàng, tự đóng/mở lại, lịch làm
// việc. Chỉ có 1 document (key = "default"). Giá trị mặc định nằm ở
// modules/ticket/domain/ticket-schedule.ts. Owner: module ticket.

const UrgencyMinutes = new Schema(
  {
    urgent: { type: Number, required: true },
    // `high` (mức Cao) thêm sau: document cũ chưa có thì lấy mặc định ở ticket-schedule.ts
    high: { type: Number },
    normal: { type: Number, required: true },
    low: { type: Number, required: true }
  },
  { _id: false }
);

const TicketSettingSchema = new Schema(
  {
    key: { type: String, required: true, default: "default" },
    // Người nhận thông báo THÊM cho ticket mức Khẩn và Cao (ngoài người của mẫu/loại/sản phẩm)
    default_handler_ids: [{ type: Schema.Types.ObjectId, ref: "user_info" }],

    workday_minutes: { type: Number, default: 540 },
    unclaimed_minutes: {
      type: UrgencyMinutes,
      default: { urgent: 360, high: 540, normal: 1080, low: 2700 }
    },
    silent_minutes: {
      type: UrgencyMinutes,
      default: { urgent: 540, high: 1080, normal: 2700, low: 5400 }
    },
    hold_unknown_days: { type: Number, default: 5 },
    auto_close_resolved_days: { type: Number, default: 3 },
    auto_close_waiting_info_days: { type: Number, default: 3 },
    reopen_days: { type: Number, default: 3 },

    // Khung giờ làm việc: phút trong ngày theo giờ VN; day_windows ghi đè theo thứ (0=CN ... 6=T7)
    work_start_minute: { type: Number, default: 480 },
    work_end_minute: { type: Number, default: 1020 },
    work_days: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    day_windows: { type: Schema.Types.Mixed, default: { 6: { startMinute: 480, endMinute: 720 } } },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket_setting",
    minimize: false
  }
);

TicketSettingSchema.index({ key: 1 }, { unique: true });

export default mongoose.model("ticket_setting", TicketSettingSchema);
