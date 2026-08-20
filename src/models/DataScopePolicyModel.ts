import mongoose, { Schema, Document } from "mongoose";
import BaseSchema from "./BaseSchema";

export interface DataScopePolicyDoc extends Document {
  code: string;
  entity: string;
  label: string;
  isSystemPolicy: boolean;
  conditionTree: Record<string, unknown> | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DataScopePolicySchema = new Schema<DataScopePolicyDoc>(
  {
    code: { type: String, required: true },
    entity: { type: String, required: true },
    label: { type: String, required: true },
    isSystemPolicy: { type: Boolean, default: false },
    conditionTree: { type: Schema.Types.Mixed, default: null },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
);

DataScopePolicySchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<DataScopePolicyDoc>("data_scope_policy", DataScopePolicySchema);
