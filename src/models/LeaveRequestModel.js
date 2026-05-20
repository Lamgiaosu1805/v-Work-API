const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const LeaveRequestSchema = new mongoose.Schema(
    {
        user_id:         { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
        from_date:       { type: Date, required: true },
        from_period:     { type: String, enum: ["morning", "afternoon"], required: true },
        to_date:         { type: Date, required: true },
        to_period:       { type: String, enum: ["morning", "afternoon"], required: true },
        total_days:  { type: Number, required: true },
        leave_type:  { type: String, enum: ["paid", "unpaid"], required: true },
        reason:          { type: String, default: "" },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected", "cancelled"],
            default: "pending",
        },
        reviewed_by:   { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
        reviewed_at:   { type: Date, default: null },
        reviewer_note: { type: String, default: "" },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON:     BaseSchema.options.toJSON,
        toObject:   BaseSchema.options.toObject,
    }
);

LeaveRequestSchema.index({ user_id: 1, status: 1 });
LeaveRequestSchema.index({ from_date: 1, to_date: 1 });

module.exports = mongoose.model("leave_request", LeaveRequestSchema);
