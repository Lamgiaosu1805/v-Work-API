const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const KpiTierAssignmentSchema = new mongoose.Schema(
  {
    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
    ttkd_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },

    tier_level: { type: Number, required: true, min: 1, max: 5 },

    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

    effective_from: { type: Date, required: true },
    effective_to: { type: Date, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

KpiTierAssignmentSchema.index({ sale_id: 1, ttkd_id: 1, effective_to: 1 });

KpiTierAssignmentSchema.index({ ttkd_id: 1, effective_to: 1 });

module.exports = mongoose.model("kpi_tier_assignment", KpiTierAssignmentSchema);
