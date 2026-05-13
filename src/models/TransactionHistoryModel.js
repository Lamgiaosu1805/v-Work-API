const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

// Lịch sử giao dịch — sync từ VNFITE_V2.tbl_transaction
const TransactionHistorySchema = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
        external_id: { type: String, required: true },              // tbl_user.ID

        external_transaction_id: { type: String, required: true },  // tbl_transaction.ID (dedup key)

        amount: { type: String, default: null },
        category: { type: Number, default: null },   // 0=nạp tiền, 1=rút tiền
        status: { type: Number, default: null },      // 0=đang xử lý, 1=thành công, 3/4/5=thất bại
        details: { type: String, default: null },
        associate_bank_id: { type: String, default: null },
        is_auto: { type: Number, default: null },     // 1=tự động, 0=thủ công
        img_id: { type: String, default: null },
        reject_reason: { type: String, default: null },
        transaction_date: { type: Date, default: null },

        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

TransactionHistorySchema.index({ app_id: 1, external_transaction_id: 1 }, { unique: true });
TransactionHistorySchema.index({ app_id: 1, customer_id: 1, transaction_date: -1 });

module.exports = mongoose.model("transaction_history", TransactionHistorySchema);
