import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Ticket hỗ trợ nội bộ. Owner: module ticket (src/modules/ticket). Thiết kế: docs/TICKET-MODULE-PLAN.md.
// Mọi id người dùng là user_info._id.

const { ObjectId } = Schema.Types;

const InfoItemSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    note: { type: String, default: "" },
    fulfilled: { type: Boolean, default: false }
  },
  { _id: false }
);

const TicketSchema = new Schema(
  {
    code: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    product_id: { type: ObjectId, ref: "ticket_product", required: true },
    category_id: { type: ObjectId, ref: "ticket_category", required: true },
    template_id: { type: ObjectId, ref: "ticket_template", default: null },
    custom_fields: { type: Schema.Types.Mixed, default: {} },
    // urgent = Khẩn, high = Cao, normal = Bình thường, low = Thấp
    urgency: { type: String, enum: ["urgent", "high", "normal", "low"], default: "normal" },

    // Snapshot khách hàng do người tạo chọn (không join lại CRM khi đọc)
    customer: {
      type: new Schema(
        {
          customer_id: { type: ObjectId, ref: "customer", default: null },
          app_code: { type: String, default: null },
          phone: { type: String, default: null },
          name: { type: String, default: null },
          external_id: { type: String, default: null }
        },
        { _id: false }
      ),
      default: null
    },
    // Nhân sự nội bộ mà ticket hỗ trợ (sản phẩm nội bộ vWork: CRM/HRM/Workplace) — thay cho khách ở trên
    related_employee_id: { type: ObjectId, ref: "user_info", default: null },

    created_by: { type: ObjectId, ref: "user_info", required: true },

    assignment: {
      mode: { type: String, enum: ["none", "department", "members"], default: "none" },
      department_id: { type: ObjectId, ref: "department", default: null },
      member_ids: [{ type: ObjectId, ref: "user_info" }],
      assigned_by: { type: ObjectId, ref: "user_info", default: null },
      owner_id: { type: ObjectId, ref: "user_info", default: null },
      collaborator_ids: [{ type: ObjectId, ref: "user_info" }],
      claimed_at: { type: Date, default: null }
    },

    status: {
      type: String,
      enum: ["open", "in_progress", "waiting_info", "on_hold", "resolved", "closed", "cancelled"],
      default: "open"
    },

    resolution: {
      type: new Schema(
        {
          code: {
            type: String,
            enum: [
              "solved",
              "wont_fix",
              "insufficient_basis",
              "not_a_bug",
              "duplicate",
              "requester_no_response"
            ],
            required: true
          },
          note: { type: String, default: "" },
          action_taken: { type: String, default: "" },
          by: { type: ObjectId, ref: "user_info", default: null },
          at: { type: Date, required: true }
        },
        { _id: false }
      ),
      default: null
    },

    // "Cần theo dõi thêm" khi báo đã xử lý
    follow_up: {
      type: new Schema(
        { note: { type: String, default: "" }, check_at: { type: Date, default: null } },
        { _id: false }
      ),
      default: null
    },

    hold: {
      type: new Schema(
        { reason: { type: String, default: "" }, resume_at: { type: Date, default: null } },
        { _id: false }
      ),
      default: null
    },

    // Checklist yêu cầu bổ sung (đang chờ người tạo)
    info_request: {
      type: new Schema(
        {
          items: [InfoItemSchema],
          note: { type: String, default: "" },
          requested_by: { type: ObjectId, ref: "user_info", default: null },
          requested_at: { type: Date, required: true }
        },
        { _id: false }
      ),
      default: null
    },

    // [CHỜ-DUYỆT-ĐIỆN-TỬ] hiện chỉ có mode "document" (file tờ trình tải lên)
    approval: {
      required: { type: Boolean, default: false },
      source: { type: String, enum: ["template", "handler", null], default: null },
      mode: { type: String, enum: ["document"], default: "document" },
      status: {
        type: String,
        enum: ["not_required", "missing", "submitted", "verified", "invalid"],
        default: "not_required"
      },
      reference: {
        type: new Schema(
          {
            number: { type: String, default: "" },
            date: { type: Date, default: null },
            signer: { type: String, default: "" }
          },
          { _id: false }
        ),
        default: null
      },
      verified_by: { type: ObjectId, ref: "user_info", default: null },
      verified_at: { type: Date, default: null },
      note: { type: String, default: "" }
    },

    visibility: { type: String, enum: ["normal", "restricted"], default: "normal" },
    related_ticket_ids: [{ type: ObjectId, ref: "ticket" }],
    duplicate_of: { type: ObjectId, ref: "ticket", default: null },

    due_hint_at: { type: Date, default: null },
    reschedule_count: { type: Number, default: 0 },
    last_activity_at: { type: Date, required: true },
    status_changed_at: { type: Date, required: true },
    // Mốc tính trước mỗi lần ticket thay đổi — cảnh báo vàng đọc thẳng từ đây, không cần cron
    alert_at: { type: Date, default: null },
    alert_reason: {
      type: String,
      enum: ["unclaimed", "silent", "overdue", "hold_unknown", null],
      default: null
    },
    auto_close_at: { type: Date, default: null },
    remind_at: { type: Date, default: null },
    reminder_sent_at: { type: Date, default: null },

    confirmed_by_requester: { type: Boolean, default: false },
    closed_at: { type: Date, default: null },
    reopen_until: { type: Date, default: null },
    reopen_count: { type: Number, default: 0 },

    // Optimistic concurrency — mọi lệnh ghi phải đúng version đã đọc
    version: { type: Number, default: 0 },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "ticket"
  }
);

TicketSchema.index({ code: 1 }, { unique: true });
TicketSchema.index({ status: 1, createdAt: -1 });
TicketSchema.index({ "assignment.owner_id": 1, status: 1 });
TicketSchema.index({ "assignment.collaborator_ids": 1, status: 1 });
TicketSchema.index({ "assignment.department_id": 1, status: 1 });
TicketSchema.index({ "assignment.member_ids": 1, status: 1 });
TicketSchema.index({ created_by: 1, createdAt: -1 });
TicketSchema.index({ alert_at: 1 });
TicketSchema.index({ auto_close_at: 1 });
TicketSchema.index({ remind_at: 1 });
TicketSchema.index({ "customer.phone": 1 });
TicketSchema.index({ related_employee_id: 1 });

export default mongoose.model("ticket", TicketSchema);
