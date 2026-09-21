import mongoose, { Schema, Document } from "mongoose";
import BaseSchema from "./BaseSchema";

export interface PermissionGrantDoc {
  permissionCode: string;
  dataScopePolicyCode: string;
  fieldScopePolicyCode: string | null;
}

export interface PermissionRoleDoc extends Document {
  name: string;
  code: string;
  description: string;
  isSystemRole: boolean;
  grants: PermissionGrantDoc[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PermissionGrantSchema = new Schema<PermissionGrantDoc>(
  {
    permissionCode: { type: String, required: true },
    dataScopePolicyCode: { type: String, required: true },
    fieldScopePolicyCode: { type: String, default: null }
  },
  { _id: false }
);

const PermissionRoleSchema = new Schema<PermissionRoleDoc>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true },
    description: { type: String, default: "" },
    isSystemRole: { type: Boolean, default: false },
    grants: { type: [PermissionGrantSchema], default: [] },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
);

PermissionRoleSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<PermissionRoleDoc>("permission_role", PermissionRoleSchema);
