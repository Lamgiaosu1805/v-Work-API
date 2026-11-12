const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const InvestmentSchema = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
        external_investment_id: { type: String, required: true },

        // === THÔNG TIN KHOẢN ĐẦU TƯ ===
        product_name: { type: String, required: true },
        amount: { type: Number, required: true },
        term_type: {
            type: String,
            enum: ["week", "month"],
            required: true,
        },
        term_value: { type: Number, required: true }, // số tuần hoặc số tháng
        interest_rate: { type: Number, required: true },
        invested_at: { type: Date, required: true },
        maturity_at: { type: Date, required: true },
        status: {
            type: String,
            enum: ["active", "matured", "cancelled", "renewed", "early_terminated"],
            default: "active",
        },

        // === HOA HỒNG ===
        commission: {
            receiver_type: { type: String, enum: ["sale", "agent"], default: null },
            sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
            agent_id: { type: mongoose.Schema.Types.ObjectId, ref: "agent", default: null },

            // Kỳ hoa hồng = tháng đầu tư
            period_month: { type: Number, default: null },
            period_year: { type: Number, default: null },

            // Công thức tính
            commission_rate: { type: Number, default: 1.8 },
            gross_amount: { type: Number, default: 0 },
            tncn_rate: { type: Number, default: null },
            tncn_amount: { type: Number, default: 0 },
            net_amount: { type: Number, default: 0 },

            // none = marketing, pending = có hoa hồng
            status: {
                type: String,
                enum: ["none", "pending"],
                default: "none",
            },
        },

        // === GHI NHẬN KPI (docs/CRM-DAILY-REPORT-FLOWS.md mục 4, R2) ===
        // Doanh số tính cho Sale đang giữ khách lúc tạo khoản (mọi kỳ hạn, độc lập hoa hồng) + TTKD lúc đó.
        // Ghi 1 lần khi tạo, KHÔNG đổi khi khách được gán/chuyển về sau (khác commission.sale_id).
        kpi_attribution: {
            type: new mongoose.Schema(
                {
                    sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
                    department_id: { type: mongoose.Schema.Types.ObjectId, ref: "department", default: null },
                    agent_id: { type: mongoose.Schema.Types.ObjectId, ref: "agent", default: null },
                    channel: { type: String, enum: ["sale", "agent", "unassigned"], required: true },
                    attributed_at: { type: Date, required: true },
                },
                { _id: false }
            ),
            default: null,
        },
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

InvestmentSchema.index({ app_id: 1, external_investment_id: 1 }, { unique: true });
InvestmentSchema.index({ customer_id: 1 });
InvestmentSchema.index({ "commission.sale_id": 1 });
InvestmentSchema.index({ "commission.agent_id": 1 });
InvestmentSchema.index({ "commission.period_month": 1, "commission.period_year": 1 });
InvestmentSchema.index({ status: 1, invested_at: 1, customer_id: 1 });
InvestmentSchema.index({ app_id: 1, invested_at: 1, "kpi_attribution.sale_id": 1 });

module.exports = mongoose.model("investment", InvestmentSchema);
