const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const CustomerClaimRequestSchema = new mongoose.Schema(
    {
        customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
        sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
        phone_number: { type: String, required: true },
        note: { type: String, default: null },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },
        resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
        resolved_at: { type: Date, default: null },
        reject_reason: { type: String, default: null },
        ...BaseSchema.obj,
    },
    {
        timestamps: true,
        collection: "customer_claim_requests",
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("customer_claim_request", CustomerClaimRequestSchema);
