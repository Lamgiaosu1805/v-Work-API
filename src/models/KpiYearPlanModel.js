const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_YEAR_PLAN_STATUS_VALUES } = require("../constants");

const MonthlyTargetSchema = new mongoose.Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    base_target: { type: Number, required: true, min: 0 },
    adjusted_target: { type: Number, required: true, min: 0 },
    is_adjusted: { type: Boolean, default: false }
  },
  { _id: false }
);

const KpiYearPlanSchema = new mongoose.Schema(
  {
    ttkd_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
    year: { type: Number, required: true },
    metric_code: { type: String, required: true, trim: true },

    year_target: { type: Number, required: true, min: 0 },
    monthly_targets: { type: [MonthlyTargetSchema], default: [] },

    status: { type: String, enum: KPI_YEAR_PLAN_STATUS_VALUES, default: "draft" },
    version: { type: Number, default: 1 },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    activated_at: { type: Date, default: null },
    note: { type: String, default: "" },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

KpiYearPlanSchema.index({ ttkd_id: 1, year: 1, metric_code: 1, version: 1 }, { unique: true });

KpiYearPlanSchema.index({ ttkd_id: 1, year: 1, metric_code: 1, status: 1 });

module.exports = mongoose.model("kpi_year_plan", KpiYearPlanSchema);
