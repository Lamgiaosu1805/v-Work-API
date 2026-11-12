const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AgentSchema = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        agent_code: { type: String, required: true },
        external_id: { type: String, required: true },
        agent_type: {
            type: String,
            enum: ["INDIVIDUAL", "ENTERPRISE"],
            required: true,
            default: "INDIVIDUAL"
        }, // Thêm trường này để phân biệt cá nhân và doanh nghiệp
        full_name: { type: String, required: true },// Tên Đại lý (Có thể là cá nhân hoặc tên doanh nghiệp)
        phone_number: { type: String, required: true },
        email: { type: String, default: null },
        address: { type: String, default: null },
        is_active: { type: Boolean, default: true },
        branch_name: { type: String, default: null },
        // Sale phụ trách đại lý/CTV — CIF + doanh số qua đại lý ghi nhận KPI cho Sale này (docs/CRM-DAILY-REPORT-FLOWS.md R4)
        manager_sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
        manager_assigned_at: { type: Date, default: null },

        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

AgentSchema.index({ app_id: 1, agent_code: 1 }, { unique: true });
AgentSchema.index({ app_id: 1, external_id: 1 }, { unique: true });

module.exports = mongoose.model("agent", AgentSchema);