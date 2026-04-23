const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const SaleKpiModel = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
        period: {
            month: { type: Number, required: true, min: 1, max: 12 },
            year: { type: Number, required: true },
        },
        targets: {
            new_customers: { type: Number, default: 0 },
            kyc_verified: { type: Number, default: 0 },
            active_investors: { type: Number, default: 0 },
            revenue: { type: Number, default: 0 },
        },
        actuals: {
            new_customers: { type: Number, default: 0 },
            kyc_verified: { type: Number, default: 0 },
            active_investors: { type: Number, default: 0 },
            revenue: { type: Number, default: 0 },
        },
        achievement: {
            new_customers_pct: { type: Number, default: 0 },
            kyc_verified_pct: { type: Number, default: 0 },
            active_investors_pct: { type: Number, default: 0 },
            revenue_pct: { type: Number, default: 0 },
            overall_pct: { type: Number, default: 0 },
        },

        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

// 1 sale chỉ có 1 bản ghi KPI mỗi tháng trên mỗi app
SaleKpiModel.index(
    { app_id: 1, sale_id: 1, "period.month": 1, "period.year": 1 },
    { unique: true }
);

module.exports = mongoose.model("sale_kpi", SaleKpiModel);