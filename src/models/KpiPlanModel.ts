import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Kế hoạch KPI năm của 1 Sale (theo Quyết định giao chỉ tiêu). Có kế hoạch năm = phải nộp báo cáo ngày
// từ `effective_from` (Q8). Bộ chỉ tiêu + trọng số theo `template_code` (TTKD / PRIORITY).
// Owner: module daily-report. Nạp bằng scripts/seedDailyReportKpiPlans.ts.

const KpiTargetSchema = new Schema(
  {
    metric_code: { type: String, required: true },
    annual: { type: Number, required: true, min: 0 },
    // 12 phần tử theo tháng; rỗng = chia đều KH năm cho 12 tháng
    monthly: { type: [Number], default: [] }
  },
  { _id: false }
);

const KpiPlanSchema = new Schema(
  {
    app_id: { type: Schema.Types.ObjectId, ref: "app", required: true },
    year: { type: Number, required: true },
    employee_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    template_code: { type: String, enum: ["TTKD", "PRIORITY"], required: true },
    effective_from: { type: String, required: true }, // YYYY-MM-DD — ngày bắt đầu phải báo cáo
    targets: { type: [KpiTargetSchema], default: [] },
    decision_ref: { type: String, default: null }, // số Quyết định giao chỉ tiêu
    note: { type: String, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "kpi_plan"
  }
);

KpiPlanSchema.index(
  { app_id: 1, year: 1, employee_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model("kpi_plan", KpiPlanSchema);
