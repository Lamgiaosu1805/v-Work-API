const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_ADJUSTMENT_REASON_VALUES, KPI_PERIOD_TYPE_VALUES } = require("../constants");

const KpiAdjustmentSchema = new mongoose.Schema(
  {
    investment_id: { type: mongoose.Schema.Types.ObjectId, ref: "investment", required: true },

    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
    ttkd_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },

    metric_code: { type: String, required: true, trim: true },

    amount: { type: Number, required: true, min: 0 },

    reason: { type: String, enum: KPI_ADJUSTMENT_REASON_VALUES, required: true },

    withdrawal_date: { type: Date, required: true },

    period_type: { type: String, enum: KPI_PERIOD_TYPE_VALUES, required: true },
    applied_period_key: { type: String, required: true, trim: true },
    note: { type: String, default: "" },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

KpiAdjustmentSchema.index({ investment_id: 1 });

KpiAdjustmentSchema.index({ sale_id: 1, applied_period_key: 1, period_type: 1 });

module.exports = mongoose.model("kpi_adjustment", KpiAdjustmentSchema);
