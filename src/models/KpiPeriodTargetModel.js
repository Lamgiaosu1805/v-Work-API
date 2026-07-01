const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_SCOPE_TYPE_VALUES, KPI_PERIOD_TYPE_VALUES } = require("../constants");

const SourceBreakdownSchema = new mongoose.Schema(
  {
    mkt: { type: Number, default: 0 },
    cbb: { type: Number, default: 0 },
    bld: { type: Number, default: 0 }
  },
  { _id: false }
);

const KpiPeriodTargetSchema = new mongoose.Schema(
  {
    scope_type: { type: String, enum: KPI_SCOPE_TYPE_VALUES, required: true },
    scope_id: { type: mongoose.Schema.Types.ObjectId, required: true },

    metric_code: { type: String, required: true, trim: true },

    period_type: { type: String, enum: KPI_PERIOD_TYPE_VALUES, required: true },
    period_key: { type: String, required: true, trim: true },

    base_target: { type: Number, default: 0 },
    rollover_in: { type: Number, default: 0 },
    effective_target: { type: Number, default: 0 },

    actual: { type: Number, default: 0 },
    achievement_pct: { type: Number, default: 0 },

    source_breakdown: { type: SourceBreakdownSchema, default: () => ({}) },

    is_closed: { type: Boolean, default: false },
    closed_at: { type: Date, default: null },
    closed_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

KpiPeriodTargetSchema.index(
  { scope_type: 1, scope_id: 1, metric_code: 1, period_type: 1, period_key: 1 },
  { unique: true }
);

KpiPeriodTargetSchema.index({ scope_id: 1, period_type: 1, period_key: 1 });

KpiPeriodTargetSchema.index({ metric_code: 1, period_type: 1, period_key: 1, scope_type: 1 });

module.exports = mongoose.model("kpi_period_target", KpiPeriodTargetSchema);
