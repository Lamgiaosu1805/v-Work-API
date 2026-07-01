const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const TierSchema = new mongoose.Schema(
  {
    level: { type: Number, required: true, min: 1, max: 5 },
    weight: { type: Number, required: true, min: 0, max: 1 }
  },
  { _id: false }
);

const KpiTierConfigSchema = new mongoose.Schema(
  {
    ttkd_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
    metric_code: { type: String, required: true, trim: true },
    year: { type: Number, required: true },

    tiers: { type: [TierSchema], default: [] },

    configured_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

KpiTierConfigSchema.index({ ttkd_id: 1, metric_code: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("kpi_tier_config", KpiTierConfigSchema);
