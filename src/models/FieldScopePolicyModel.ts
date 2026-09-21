import mongoose, { Schema, Document } from "mongoose";
import BaseSchema from "./BaseSchema";

export interface FieldScopePolicyDoc extends Document {
  code: string;
  entity: string;
  label: string;
  isSystemPolicy: boolean;
  fields: string[];
  conditionTree: Record<string, unknown> | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FieldScopePolicySchema = new Schema<FieldScopePolicyDoc>(
  {
    code: { type: String, required: true },
    entity: { type: String, required: true },
    label: { type: String, required: true },
    isSystemPolicy: { type: Boolean, default: false },
    fields: { type: [String], required: true },
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

FieldScopePolicySchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<FieldScopePolicyDoc>("field_scope_policy", FieldScopePolicySchema);
