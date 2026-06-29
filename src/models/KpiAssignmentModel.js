const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_ASSIGNMENT_STATUS_VALUES } = require("../constants");

const KpiAssignmentSchema = new mongoose.Schema(
  {
    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
    ttkd_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    version: { type: Number, default: 1 },

    items: [
      {
        metric_code: { type: String, required: true },
        target: { type: Number, required: true, min: 0 },
        _id: false
      }
    ],

    status: { type: String, enum: KPI_ASSIGNMENT_STATUS_VALUES, default: "draft" },
    note: { type: String, default: "" },
    activated_at: { type: Date, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

KpiAssignmentSchema.index({ sale_id: 1, year: 1, month: 1, version: 1 }, { unique: true });

KpiAssignmentSchema.index({ sale_id: 1, year: 1, month: 1, status: 1 });

KpiAssignmentSchema.index({ ttkd_id: 1, year: 1, month: 1 });

module.exports = mongoose.model("kpi_assignment", KpiAssignmentSchema);
