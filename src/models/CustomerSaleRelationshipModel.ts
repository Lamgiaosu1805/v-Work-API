import mongoose, { Schema, Document, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

export type CustomerSaleRelationshipStatus = "not_friended" | "friended" | "friended_no_response";

export interface CustomerSaleRelationshipDoc extends Document {
  customer_id: mongoose.Types.ObjectId;
  sale_id: mongoose.Types.ObjectId;
  status: CustomerSaleRelationshipStatus;
  updated_by: mongoose.Types.ObjectId;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSaleRelationshipSchema = new Schema<CustomerSaleRelationshipDoc>(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: "customer", required: true },
    sale_id: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    status: {
      type: String,
      enum: ["not_friended", "friended", "friended_no_response"],
      required: true
    },
    updated_by: { type: Schema.Types.ObjectId, ref: "account", required: true },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions<CustomerSaleRelationshipDoc>["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions<CustomerSaleRelationshipDoc>["toObject"]
  }
);

CustomerSaleRelationshipSchema.index(
  { customer_id: 1, sale_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<CustomerSaleRelationshipDoc>(
  "customer_sale_relationship",
  CustomerSaleRelationshipSchema
);
