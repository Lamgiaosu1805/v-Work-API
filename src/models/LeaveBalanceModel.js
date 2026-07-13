const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { LEAVE_BALANCE_REASON_VALUES } = require("../constants");

const LeaveBalanceSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },

    amount: { type: Number, required: true },

    reason: { type: String, enum: LEAVE_BALANCE_REASON_VALUES, required: true },

    ref_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    ref_type: { type: String, enum: ["request", "system", "manual"], default: null },

    note: { type: String, default: "" },

    balance_after: { type: Number, default: null },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

LeaveBalanceSchema.index({ user_id: 1, isDeleted: 1 });
LeaveBalanceSchema.index({ user_id: 1, createdAt: -1 });
LeaveBalanceSchema.index({ ref_type: 1, ref_id: 1 });

module.exports = mongoose.model("leave_balance", LeaveBalanceSchema);
