const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const TierSchema = new mongoose.Schema(
  {
    level:     { type: Number, required: true, min: 1, max: 5 },
    // Ngưỡng tối thiểu để được xếp bậc này (achievement_pct hoặc giá trị tuyệt đối tùy metric)
    threshold: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const KpiTierConfigSchema = new mongoose.Schema(
  {
    ttkd_id:      { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
    metric_code:  { type: String, required: true, trim: true },
    year:         { type: Number, required: true },

    // 5 bậc — level 1 thấp nhất, level 5 cao nhất; threshold tăng dần
    tiers: { type: [TierSchema], default: [] },

    configured_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON:     BaseSchema.options.toJSON,
    toObject:   BaseSchema.options.toObject
  }
);

// Mỗi TTKD chỉ có 1 cấu hình bậc cho (metric, năm)
KpiTierConfigSchema.index({ ttkd_id: 1, metric_code: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("kpi_tier_config", KpiTierConfigSchema);
