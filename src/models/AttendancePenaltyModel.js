const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AttendancePenaltySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["late", "early"], default: "late" },
    from_minutes: { type: Number, required: true, min: 0 },
    to_minutes: { type: Number, default: null },
    penalty_kind: { type: String, enum: ["money", "work_unit"], required: true },
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
