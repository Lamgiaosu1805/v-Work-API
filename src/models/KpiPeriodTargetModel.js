const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_SCOPE_TYPE_VALUES, KPI_PERIOD_TYPE_VALUES } = require("../constants");

// Breakdown doanh số theo nguồn: MKT / CBB / BLĐ
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
    // Ai là chủ thể: TTKD-level hay Sale-level
    scope_type: { type: String, enum: KPI_SCOPE_TYPE_VALUES, required: true },
    // scope_type = "ttkd" → department._id
    // scope_type = "sale" → user_info._id
    scope_id: { type: mongoose.Schema.Types.ObjectId, required: true },

    metric_code: { type: String, required: true, trim: true },

    // Kỳ thời gian
    period_type: { type: String, enum: KPI_PERIOD_TYPE_VALUES, required: true },
    // Định danh kỳ theo period_type:
    //   day     → "2026-06-29"
    //   week    → "2026-W26"
    //   month   → "2026-06"
    //   quarter → "2026-Q2"
    //   year    → "2026"
    period_key: { type: String, required: true, trim: true },

    // Mục tiêu
    base_target:      { type: Number, default: 0 }, // từ phân rã assignment/year_plan
    rollover_in:      { type: Number, default: 0 }, // nợ cộng dồn từ kỳ trước (rollover)
    effective_target: { type: Number, default: 0 }, // = base_target + rollover_in — giá trị thực tế cần đạt

    // Thực hiện
    actual:          { type: Number, default: 0 },
    achievement_pct: { type: Number, default: 0 }, // actual / effective_target * 100

    // Phân tách theo nguồn (chỉ có ý nghĩa với metric doanh số)
    source_breakdown: { type: SourceBreakdownSchema, default: () => ({}) },

    // Chốt tháng (month-end close): khóa bản ghi, không cập nhật actual nữa
    is_closed:  { type: Boolean, default: false },
    closed_at:  { type: Date, default: null },
    closed_by:  { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON:     BaseSchema.options.toJSON,
    toObject:   BaseSchema.options.toObject
  }
);

// 1 chủ thể chỉ có 1 bản ghi cho (metric, period_type, period_key)
KpiPeriodTargetSchema.index(
  { scope_type: 1, scope_id: 1, metric_code: 1, period_type: 1, period_key: 1 },
  { unique: true }
);

// Aggregate toàn bộ metric trong 1 kỳ (dashboard)
KpiPeriodTargetSchema.index({ scope_id: 1, period_type: 1, period_key: 1 });

// Query tất cả Sale của 1 TTKD trong 1 kỳ (bảng tổng hợp Trưởng phòng)
KpiPeriodTargetSchema.index({ metric_code: 1, period_type: 1, period_key: 1, scope_type: 1 });

module.exports = mongoose.model("kpi_period_target", KpiPeriodTargetSchema);
