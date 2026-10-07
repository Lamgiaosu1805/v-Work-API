const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const CustomerInteractionModel = new mongoose.Schema(
    {
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },
        customer_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
        sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
        agent_id: { type: mongoose.Schema.Types.ObjectId, ref: "agent", default: null },
        type: {
            type: String,
            enum: [
                "call",
                "meeting",
                "message",
                "email",
                "note",
                "kyc_updated",
                "status_changed",
                "reassigned",
            ],
            required: true,
        },
        content: { type: String, default: null },
        result: {
            type: String,
            enum: [
                "interested",
                "not_interested",
                "need_more_info",
                "will_invest",
                "invested",
                "no_answer",
            ],
            default: null,
        },
        next_action: {
            description: { type: String, default: null },
            due_date: { type: Date, default: null },
        },
        // === Báo cáo chăm sóc theo Quy định 183A, Điều 7.2 ===
        // Kết quả liên hệ (nghe máy hay không); trạng thái hiện tại = `result`; bước tiếp theo = next_action
        contact_result: {
            type: String,
            enum: ["connected", "no_answer", "busy", "wrong_number", "callback_requested", "message_replied", null],
            default: null,
        },
        customer_need: { type: String, default: null },
        lost_reason: {
            type: String,
            enum: ["no_need", "not_eligible", "product_mismatch", "competitor", "unreachable", "wrong_contact", "other", null],
            default: null,
        },
        call_log_id: { type: mongoose.Schema.Types.ObjectId, ref: "call_log", default: null },
        assignment_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer_assignment", default: null },
        // true = được tính là hoạt động chăm sóc hợp lệ cho SLA (đủ 4 trường bắt buộc)
        is_valid_activity: { type: Boolean, default: false },
        metadata: {
            old_status: { type: String, default: null },
            new_status: { type: String, default: null },
            from_sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
            to_sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
            removed_sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
            assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
            removed_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
            reason: { type: String, default: null },
            confirm_sale_source: { type: Boolean, default: null },
            // Code duyệt/huỷ yêu cầu nhận khách đã ghi các field này nhưng trước đây schema thiếu
            // nên Mongoose loại bỏ → mất dấu người duyệt/huỷ (audit)
            approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
            revoked_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
            claim_request_id: { type: mongoose.Schema.Types.ObjectId, ref: "customer_claim_request", default: null },
            cif_hh_granted: { type: Boolean, default: null },
            ekyc_hh_granted: { type: Boolean, default: null },
        },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

// Index để query nhanh theo app + sale hoặc app + customer
CustomerInteractionModel.index({ app_id: 1, sale_id: 1 });
CustomerInteractionModel.index({ app_id: 1, customer_id: 1 });
CustomerInteractionModel.index({ type: 1, createdAt: 1, customer_id: 1 });

module.exports = mongoose.model("customer_interaction", CustomerInteractionModel);
