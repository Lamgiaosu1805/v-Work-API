const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const CustomerInteractionModel = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
        sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
        agent_id: { type: mongoose.Schema.Types.ObjectId, ref: "agent", default: null },
        type: {
            type: String,
            enum: [
                "call",
                "meeting",
                "message",
                "email",
                "note",
                "kyc_updated",
                "status_changed",
            ],
            required: true,
        },
        content: { type: String, default: null },
        result: {
            type: String,
            enum: [
                "interested",
                "not_interested",
                "need_more_info",
                "will_invest",
                "invested",
                "no_answer",
            ],
            default: null,
        },
        next_action: {
            description: { type: String, default: null },
            due_date: { type: Date, default: null },
        },
        metadata: {
            old_status: { type: String, default: null },
            new_status: { type: String, default: null },
        },

        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

// Index để query nhanh theo app + sale hoặc app + customer
CustomerInteractionModel.index({ app_id: 1, sale_id: 1 });
CustomerInteractionModel.index({ app_id: 1, customer_id: 1 });

module.exports = mongoose.model("customer_interaction", CustomerInteractionModel);