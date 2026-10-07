import mongoose, { Schema, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

// Cấu hình chính sách chăm sóc khách theo app (SLA, hạn mức, ngưỡng). CRM/IT chỉnh qua API.
// Owner: module customer-care. Field thiếu sẽ lấy giá trị mặc định ở domain/care-policy.ts.

const ClassSlaSchema = new Schema(
  {
    first_contact_minutes: Number,
    warn_minutes: Number,
    revoke_minutes: Number,
    inactivity_minutes: Number,
    min_attempts_if_not_connected: Number
  },
  { _id: false }
);

const RankCapacitySchema = new Schema({ new_per_day: Number, total: Number }, { _id: false });

const CustomerCarePolicySchema = new Schema(
  {
    app_code: { type: String, required: true },
    enabled: { type: Boolean, default: false },
    sla: {
      A: { type: ClassSlaSchema, default: undefined },
      B: { type: ClassSlaSchema, default: undefined }
    },
    valid_call_min_answer_sec: { type: Number, default: undefined },
    max_sale_rounds: { type: Number, default: undefined },
    appointment_grace_minutes: { type: Number, default: undefined },
    capacity_by_rank: {
      A: { type: RankCapacitySchema, default: undefined },
      B: { type: RankCapacitySchema, default: undefined },
      C: { type: RankCapacitySchema, default: undefined },
      D: { type: RankCapacitySchema, default: undefined }
    },
    default_rank: { type: String, enum: ["A", "B", "C", "D"], default: undefined },
    auto_revoke_referral: { type: Boolean, default: undefined },
    work_start_minute: { type: Number, default: undefined },
    work_end_minute: { type: Number, default: undefined },
    version: { type: Number, default: 1 },
    updated_by: { type: Schema.Types.ObjectId, ref: "account", default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions["toObject"],
    collection: "customer_care_policy"
  }
);

CustomerCarePolicySchema.index(
  { app_code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model("customer_care_policy", CustomerCarePolicySchema);
