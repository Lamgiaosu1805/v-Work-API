import mongoose, { Schema, Document } from "mongoose";
import BaseSchema from "./BaseSchema";

export type PermissionActionKind = "READ" | "WRITE" | "STRUCTURAL";

export interface PermissionCatalogDoc extends Document {
  code: string;
  module: string;
  name: string;
  entity: string;
  actionKind: PermissionActionKind;
  supportsFieldScope: boolean;
  validDataScopePolicies: string[];
  validFieldScopePolicies: string[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PermissionCatalogSchema = new Schema<PermissionCatalogDoc>(
  {
    code: { type: String, required: true },
    module: { type: String, required: true },
    name: { type: String, required: true },
    entity: { type: String, required: true },
    actionKind: { type: String, enum: ["READ", "WRITE", "STRUCTURAL"], required: true },
    supportsFieldScope: { type: Boolean, default: false },
    validDataScopePolicies: { type: [String], default: [] },
    validFieldScopePolicies: { type: [String], default: [] },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
);

PermissionCatalogSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<PermissionCatalogDoc>("permission_catalog", PermissionCatalogSchema);
