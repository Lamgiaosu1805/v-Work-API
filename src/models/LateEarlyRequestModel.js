const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const LateEarlyRequestSchema = new mongoose.Schema(
    {
        user_id:       { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
        type:          { type: String, enum: ["late", "early_out"], required: true },
        date:          { type: Date, required: true },
        shift_id:      { type: mongoose.Schema.Types.ObjectId, ref: "shift", required: true },
        reason:        { type: String, default: "" },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },
        reviewed_by:   { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
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

LateEarlyRequestSchema.index({ user_id: 1, date: -1 });

module.exports = mongoose.model("late_early_request", LateEarlyRequestSchema);
