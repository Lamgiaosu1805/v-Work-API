import mongoose, { Schema, Document, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

export type FecLeadStage =
  | "FOLLOW_UP"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "STOPPED"
  | "REJECTED_AT_START";

export interface FecLeadHistoryItemDoc {
  callback_id: string;
  status: string;
  remark: string | null;
  request_time: string | null;
  received_at: Date;
  app_id: string | null;
  app_type: string | null;
  offer_amt: number | null;
  cash_amt: number | null;
  insurance_amt: number | null;
  topup_amt: number | null;
}

export interface FecLeadDoc extends Document {
  app_code: string;
  partner: string;
  customer_id: mongoose.Types.ObjectId;
  customer_external_id: string;
  lead_gen_id: string;
  trans_id: string;
  lead_status: string;
  lead_created_at: Date;
  stage: FecLeadStage;
  current_status: string | null;
  current_status_at: Date | null;
  last_step: string | null;
  stop_reason: string | null;
  dropped_off: boolean;
  is_final: boolean;
  app_id: string | null;
  app_type: string | null;
  offer_amt: number | null;
  cash_amt: number | null;
  insurance_amt: number | null;
  topup_amt: number | null;
  fec_referral_code: string | null;
  version: number;
  last_event_at: Date;
  last_event_id: string;
  history: FecLeadHistoryItemDoc[];
  commission_status: "pending" | "calculated";
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FecLeadHistoryItemSchema = new Schema<FecLeadHistoryItemDoc>(
  {
    callback_id: { type: String, required: true },
    status: { type: String, required: true },
    remark: { type: String, default: null },
    request_time: { type: String, default: null },
    received_at: { type: Date, required: true },
    app_id: { type: String, default: null },
    app_type: { type: String, default: null },
    offer_amt: { type: Number, default: null },
    cash_amt: { type: Number, default: null },
    insurance_amt: { type: Number, default: null },
    topup_amt: { type: Number, default: null }
  },
  { _id: false }
);

const FecLeadSchema = new Schema<FecLeadDoc>(
  {
    app_code: { type: String, required: true },
    partner: { type: String, required: true },
    customer_id: { type: Schema.Types.ObjectId, ref: "customer", required: true },
    customer_external_id: { type: String, required: true },
    lead_gen_id: { type: String, required: true },
    trans_id: { type: String, required: true },
    lead_status: { type: String, required: true },
    lead_created_at: { type: Date, required: true },
    stage: {
      type: String,
      enum: ["FOLLOW_UP", "IN_PROGRESS", "COMPLETED", "STOPPED", "REJECTED_AT_START"],
      required: true
    },
    current_status: { type: String, default: null },
    current_status_at: { type: Date, default: null },
    last_step: { type: String, default: null },
    stop_reason: { type: String, default: null },
    dropped_off: { type: Boolean, default: false },
    is_final: { type: Boolean, default: false },
    app_id: { type: String, default: null },
    app_type: { type: String, default: null },
    offer_amt: { type: Number, default: null },
    cash_amt: { type: Number, default: null },
    insurance_amt: { type: Number, default: null },
    topup_amt: { type: Number, default: null },
    fec_referral_code: { type: String, default: null },
    version: { type: Number, required: true },
    last_event_at: { type: Date, required: true },
    last_event_id: { type: String, required: true },
    history: { type: [FecLeadHistoryItemSchema], default: [] },
    commission_status: { type: String, enum: ["pending", "calculated"], default: "pending" },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions<FecLeadDoc>["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions<FecLeadDoc>["toObject"]
  }
);

FecLeadSchema.index(
  { lead_gen_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
FecLeadSchema.index({ customer_id: 1 });
FecLeadSchema.index({ stage: 1, commission_status: 1 });

export default mongoose.model<FecLeadDoc>("fec_lead", FecLeadSchema);
