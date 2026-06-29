const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_ADJUSTMENT_REASON_VALUES, KPI_PERIOD_TYPE_VALUES } = require("../constants");

const KpiAdjustmentSchema = new mongoose.Schema(
  {
    // Khoản đầu tư bị tất toán / rút sớm
    investment_id: { type: mongoose.Schema.Types.ObjectId, ref: "investment", required: true },

    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info",  required: true },
    ttkd_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },

    metric_code: { type: String, required: true, trim: true }, // thường là metric doanh số

    // Số tiền bị truy thu (luôn dương — trừ vào actual)
    amount: { type: Number, required: true, min: 0 },

    // Lý do: tất toán trước hạn hoặc hủy hợp đồng
    reason: { type: String, enum: KPI_ADJUSTMENT_REASON_VALUES, required: true },

    // Ngày KH thực hiện rút / tất toán
    withdrawal_date: { type: Date, required: true },

    // Kỳ bị trừ (xác định theo quy tắc clawback: tuần / tháng / năm)
    period_type:        { type: String, enum: KPI_PERIOD_TYPE_VALUES, required: true },
    applied_period_key: { type: String, required: true, trim: true },
    // VD: period_type="week",  applied_period_key="2026-W24"
    //     period_type="month", applied_period_key="2026-06"
    //     period_type="year",  applied_period_key="2026"

    note:       { type: String, default: "" },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON:     BaseSchema.options.toJSON,
    toObject:   BaseSchema.options.toObject
  }
);

// Trace toàn bộ adjustment của 1 khoản đầu tư (1 khoản có thể sinh nhiều dòng nếu trừ nhiều kỳ)
KpiAdjustmentSchema.index({ investment_id: 1 });

// Tổng adjustment của 1 Sale trong 1 kỳ (dùng khi tính actual của period_target)
KpiAdjustmentSchema.index({ sale_id: 1, applied_period_key: 1, period_type: 1 });

module.exports = mongoose.model("kpi_adjustment", KpiAdjustmentSchema);
