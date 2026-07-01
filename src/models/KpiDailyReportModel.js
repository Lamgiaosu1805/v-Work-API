const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { KPI_DAILY_REPORT_STATUS_VALUES } = require("../constants");

const DailyReportItemSchema = new mongoose.Schema(
  {
    metric_code: { type: String, required: true, trim: true },
    value: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const KpiDailyReportSchema = new mongoose.Schema(
  {
    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
    ttkd_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", required: true },

    date: { type: Date, required: true },

    items: { type: [DailyReportItemSchema], default: [] },

    status: { type: String, enum: KPI_DAILY_REPORT_STATUS_VALUES, default: "draft" },
    submitted_at: { type: Date, default: null },
    note: { type: String, default: "" },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

KpiDailyReportSchema.index({ sale_id: 1, date: 1 }, { unique: true });

KpiDailyReportSchema.index({ ttkd_id: 1, date: 1, status: 1 });

module.exports = mongoose.model("kpi_daily_report", KpiDailyReportSchema);
