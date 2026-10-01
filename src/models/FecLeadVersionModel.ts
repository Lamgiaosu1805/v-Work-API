import mongoose, { Schema, Document } from "mongoose";
import { FecLeadStage } from "./FecLeadModel";

export interface FecLeadVersionDoc extends Document {
  lead_gen_id: string;
  customer_id: mongoose.Types.ObjectId;
  event_id: string;
  version: number;
  stage: FecLeadStage;
  current_status: string | null;
  current_status_at: Date | null;
  last_step: string | null;
  stop_reason: string | null;
  dropped_off: boolean;
  is_final: boolean;
  offer_amt: number | null;
  cash_amt: number | null;
  insurance_amt: number | null;
  topup_amt: number | null;
  applied_at: Date;
}

const FecLeadVersionSchema = new Schema<FecLeadVersionDoc>(
  {
    lead_gen_id: { type: String, required: true },
    customer_id: { type: Schema.Types.ObjectId, ref: "customer", required: true },
    event_id: { type: String, required: true },
    version: { type: Number, required: true },
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
    offer_amt: { type: Number, default: null },
    cash_amt: { type: Number, default: null },
    insurance_amt: { type: Number, default: null },
    topup_amt: { type: Number, default: null },
    applied_at: { type: Date, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

FecLeadVersionSchema.index({ lead_gen_id: 1, version: 1 }, { unique: true });

export default mongoose.model<FecLeadVersionDoc>("fec_lead_version", FecLeadVersionSchema);
