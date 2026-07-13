const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AttendancePenaltySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["late", "early", "forgot"], default: "late" },
    // Dùng cho type "late"/"early": ngưỡng theo số phút đi muộn/về sớm
    from_minutes: { type: Number, min: 0, default: null },
    to_minutes: { type: Number, default: null },
    // Dùng cho type "forgot": ngưỡng theo số lần quên chấm công trong tháng dương lịch
    from_count: { type: Number, min: 1, default: null },
    to_count: { type: Number, default: null },
    penalty_kind: { type: String, enum: ["money", "work_unit", "half_day_money"], required: true },
    penalty_value: { type: Number, required: true, min: 0 },
    effective_from: { type: Date, required: true },
    description: { type: String, default: "", trim: true },
    is_active: { type: Boolean, default: true },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
    collection: "attendance_penalty_tiers",
  },
);

AttendancePenaltySchema.index({ type: 1, effective_from: -1, is_active: 1 });

module.exports = mongoose.model("attendance_penalty", AttendancePenaltySchema);
