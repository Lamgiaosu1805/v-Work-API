const { default: mongoose } = require("mongoose");
const BaseSchema = require("./BaseSchema");

const TransactionManagementModel = new mongoose.Schema(
  {
    id: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    fullName: { type: String, required: true },
    amount: { type: String, required: true },
    imgId: { type: String, required: true },
    category: { type: String, required: true },
    status: { type: String, required: true },
    details: { type: String, required: true },
    bankAccountNumber: { type: String, required: true },
    bankAccountName: { type: String, default: null },
    bankCode: { type: String, required: true },
    createdDate: { type: String, required: true },
    rejectReason: { type: String, default: null },
    base64: { type: String, default: null },
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  },
);

TransactionManagementModel.index({ id: 1 }, { unique: true });

module.exports = mongoose.model("transaction_management", TransactionManagementModel);