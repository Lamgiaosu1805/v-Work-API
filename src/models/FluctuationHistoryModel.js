const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

// Lịch sử biến động số dư — sync từ VNF_ACCOUNT_MANAGEMENT.tbl_account_balance_fluctuation
const FluctuationHistorySchema = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
        external_id: { type: String, required: true },              // tbl_user.ID

        external_fluctuation_id: { type: String, required: true },  // tbl_account_balance_fluctuation.id (dedup key)

        acc_no: { type: String, default: null },                    // VNC0000000148
        acc_name: { type: String, default: null },
        transaction_id: { type: String, default: null },
        fluctuated_amount: { type: String, default: null },
        total_remaining_amount: { type: String, default: null },
        content: { type: String, default: null },
        is_plus: { type: Boolean, default: null },                  // true=tiền vào, false=tiền ra
        transaction_date: { type: Date, default: null },
        created_by: { type: String, default: null },

        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

FluctuationHistorySchema.index({ app_id: 1, external_fluctuation_id: 1 }, { unique: true });
FluctuationHistorySchema.index({ app_id: 1, customer_id: 1, transaction_date: -1 });

module.exports = mongoose.model("fluctuation_history", FluctuationHistorySchema);
