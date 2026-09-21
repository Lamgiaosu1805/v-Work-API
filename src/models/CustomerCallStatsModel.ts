import mongoose, { Schema, Document, SchemaOptions } from "mongoose";
import BaseSchema from "./BaseSchema";

export interface CustomerCallStatsDoc extends Document {
  customer_id: mongoose.Types.ObjectId;
  call_count: number;
  last_contacted_at: Date | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerCallStatsSchema = new Schema<CustomerCallStatsDoc>(
  {
    customer_id: { type: Schema.Types.ObjectId, ref: "customer", required: true },
    call_count: { type: Number, default: 0 },
    last_contacted_at: { type: Date, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON as SchemaOptions<CustomerCallStatsDoc>["toJSON"],
    toObject: BaseSchema.options.toObject as SchemaOptions<CustomerCallStatsDoc>["toObject"]
  }
);

CustomerCallStatsSchema.index(
  { customer_id: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<CustomerCallStatsDoc>("customer_call_stats", CustomerCallStatsSchema);
