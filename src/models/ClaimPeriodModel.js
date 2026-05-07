const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const ClaimPeriodSchema = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        start_at: { type: Date, required: true },
        end_at: { type: Date, required: true },
        is_active: { type: Boolean, default: true },
        note: { type: String, default: null },
        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("claim_period", ClaimPeriodSchema);