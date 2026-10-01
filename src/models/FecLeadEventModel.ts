import mongoose, { Schema, Document } from "mongoose";

export interface FecLeadEventDoc extends Document {
  event_id: string;
  lead_gen_id: string;
  createdAt: Date;
}

const FecLeadEventSchema = new Schema<FecLeadEventDoc>(
  {
    event_id: { type: String, required: true },
    lead_gen_id: { type: String, required: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

FecLeadEventSchema.index({ event_id: 1 }, { unique: true });

export default mongoose.model<FecLeadEventDoc>("fec_lead_event", FecLeadEventSchema);
