import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Báo cáo ngày của Sale: kế hoạch đầu ngày + kết quả cuối ngày (số nhập tay + giải trình).
// Số tự động (đầu tư, CIF, cuộc gọi…) KHÔNG lưu ở đây — tính từ ghi nhận KPI lúc xem.
// Owner: module daily-report. Xem docs/CRM-DAILY-REPORT-FLOWS.md mục 5.

const MetricValueSchema = new Schema(
  {
    metric_code: { type: String, required: true },
    value: { type: Number, required: true, min: 0 },
    note: { type: String, default: null }
  },
  { _id: false }
);

const DailyReportSchema = new Schema(
  {
    app_id: { type: Schema.Types.ObjectId, ref: "app", required: true },
    employee_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    // TTKD của Sale tại ngày báo cáo — giữ lịch sử khi Sale điều chuyển
    department_id: { type: Schema.Types.ObjectId, ref: "department", default: null },
    report_date: { type: String, required: true }, // YYYY-MM-DD giờ Việt Nam

    plan: {
      targets: { type: [MetricValueSchema], default: [] },
      note: { type: String, default: null },
      submitted_at: { type: Date, default: null }, // lần nộp đầu — dùng tính đúng hạn
      updated_at: { type: Date, default: null }
    },

    result: {
      values: { type: [MetricValueSchema], default: [] },
      achievements: { type: String, default: null },
      blockers: { type: String, default: null },
      proposals: { type: String, default: null },
      submitted_at: { type: Date, default: null }, // lần nộp đầu — dùng tính đúng hạn
      updated_at: { type: Date, default: null }
    },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "daily_report"
  }
);

DailyReportSchema.index(
  { app_id: 1, employee_id: 1, report_date: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
DailyReportSchema.index({ app_id: 1, report_date: 1 });

export default mongoose.model("daily_report", DailyReportSchema);
