const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const WorkDayStatusSchema = new mongoose.Schema(
  {
    user_id:      { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
    worksheet_id: { type: mongoose.Schema.Types.ObjectId, ref: "work_sheet", required: true },
    date:         { type: Date, required: true },
    period:       { type: String, enum: ["morning", "afternoon", "full"], required: true },
    status:       { type: String, enum: ["pending", "present", "absent", "leave_paid", "leave_unpaid", "remote"], required: true },
    sources: [
      {
        ref_id:   { type: mongoose.Schema.Types.ObjectId, required: true },
        ref_type: { type: String, enum: ["request", "system", "attendance"], required: true },
      },
    ],
    ...BaseSchema.obj,
  },
  { ...BaseSchema.options, collection: "work_day_statuses" },
);

WorkDayStatusSchema.index({ user_id: 1, date: 1 });
WorkDayStatusSchema.index({ worksheet_id: 1 });
WorkDayStatusSchema.index({ user_id: 1, date: 1, period: 1 }, { unique: true });

module.exports = mongoose.model("work_day_status", WorkDayStatusSchema);
