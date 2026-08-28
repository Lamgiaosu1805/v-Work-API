import mongoose, { Schema, Document, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

export interface SaleOmicallProfileDoc extends Document {
  sale_id: mongoose.Types.ObjectId;
  sip_realm: string;
  omicall_extension: string;
  sip_password: string;
  omicall_agent_id: string | null;
  omicall_email: string;
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
