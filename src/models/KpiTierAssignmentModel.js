const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const KpiTierAssignmentSchema = new mongoose.Schema(
  {
    sale_id:     { type: mongoose.Schema.Types.ObjectId, ref: "user_info",  required: true },
    ttkd_id:     { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },
    metric_code: { type: String, required: true, trim: true },

    tier_level: { type: Number, required: true, min: 1, max: 5 },

    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

    // effective_to = null nghĩa là đang áp dụng hiện tại
    effective_from: { type: Date, required: true },
    effective_to:   { type: Date, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON:     BaseSchema.options.toJSON,
    toObject:   BaseSchema.options.toObject
  }
);

// Tra bậc hiện tại của 1 Sale theo metric: lọc effective_to = null
KpiTierAssignmentSchema.index({ sale_id: 1, metric_code: 1, effective_to: 1 });

// Danh sách toàn bộ Sale được gán bậc trong 1 TTKD
KpiTierAssignmentSchema.index({ ttkd_id: 1, metric_code: 1, effective_to: 1 });

module.exports = mongoose.model("kpi_tier_assignment", KpiTierAssignmentSchema);
