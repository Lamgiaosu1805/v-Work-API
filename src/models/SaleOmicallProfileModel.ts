import mongoose, { Schema, Document, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

export interface SaleOmicallProfileDoc extends Document {
  sale_id: mongoose.Types.ObjectId;
  sip_realm: string;
  omicall_extension: string;
  sip_password: string;
  omicall_agent_id: string | null;
  omicall_email: string;
  status: "active" | "transferring";
  pending_transfer_request_id: string | null;
  pending_transfer_target_sale_id: mongoose.Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SaleOmicallProfileSchema = new Schema<SaleOmicallProfileDoc>(
  {
    sale_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    sip_realm: { type: String, required: true },
    omicall_extension: { type: String, required: true },
    sip_password: { type: String, required: true },
    omicall_agent_id: { type: String, default: null },
    omicall_email: { type: String, required: true },
    status: { type: String, enum: ["active", "transferring"], default: "active" },
    pending_transfer_request_id: { type: String, default: null },
    pending_transfer_target_sale_id: {
      type: Schema.Types.ObjectId,
      ref: "user_info",
      default: null
    },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions<SaleOmicallProfileDoc>["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions<SaleOmicallProfileDoc>["toObject"]
  }
);

SaleOmicallProfileSchema.index(
  { sale_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<SaleOmicallProfileDoc>(
  "sale_omicall_profile",
  SaleOmicallProfileSchema
);
