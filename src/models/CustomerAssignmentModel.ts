import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Lượt giao khách cho Sale + mốc SLA (Quy định 183A). Owner: module customer-care.

const CustomerAssignmentSchema = new Schema(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: "customer", required: true },
    app_id: { type: Schema.Types.ObjectId, ref: "app", required: true },
    sale_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    round: { type: Number, required: true, min: 1 },
    channel: { type: String, enum: ["auto", "manual", "referral", "claim"], required: true },
    priority_class: { type: String, enum: ["A", "B"], required: true },
    assigned_at: { type: Date, required: true },
    assigned_by: { type: Schema.Types.ObjectId, ref: "account", default: null },
    auto_revoke: { type: Boolean, default: true },

    first_contact_due_at: { type: Date, required: true },
    warn_at: { type: Date, required: true },
    revoke_at: { type: Date, required: true },
    inactivity_due_at: { type: Date, required: true },

    first_contact_at: { type: Date, default: null },
    first_contact_breached: { type: Boolean, default: false },
    last_valid_activity_at: { type: Date, default: null },
    attempt_count: { type: Number, default: 0 },
    attempts_since_valid: { type: Number, default: 0 },
    warned_at: { type: Date, default: null },
    inactivity_warned_at: { type: Date, default: null },
    appointment_at: { type: Date, default: null },

    status: { type: String, enum: ["active", "ended"], default: "active" },
    ended_at: { type: Date, default: null },
    ended_reason: {
      type: String,
      enum: [
        "revoked_no_contact",
        "revoked_inactive",
        "revoked_manual",
        "sale_offboarded",
        "reassigned",
        "claimed",
        "converted",
        null
      ],
      default: null
    },
    ended_by: { type: Schema.Types.ObjectId, ref: "account", default: null },
    end_note: { type: String, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "customer_assignment"
  }
);

// Mỗi khách chỉ có tối đa 1 lượt giao đang hiệu lực
CustomerAssignmentSchema.index(
  { customer_id: 1 },
  { unique: true, partialFilterExpression: { status: "active", isDeleted: false } }
);
CustomerAssignmentSchema.index({ sale_id: 1, status: 1, first_contact_due_at: 1 });
CustomerAssignmentSchema.index({ sale_id: 1, assigned_at: -1 });
CustomerAssignmentSchema.index({ status: 1, warn_at: 1 });
CustomerAssignmentSchema.index({ status: 1, revoke_at: 1 });
CustomerAssignmentSchema.index({ status: 1, inactivity_due_at: 1 });
CustomerAssignmentSchema.index({ customer_id: 1, assigned_at: -1 });
CustomerAssignmentSchema.index({ ended_reason: 1, ended_at: -1 });

export default mongoose.model("customer_assignment", CustomerAssignmentSchema);
