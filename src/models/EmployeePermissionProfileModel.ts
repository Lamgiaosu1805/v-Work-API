import mongoose, { Schema, Document } from "mongoose";
import BaseSchema from "./BaseSchema";

export interface PermissionOverrideDoc {
  permissionCode: string;
  status: "ALLOW" | "BLOCK";
  dataScopePolicyCode?: string | null;
  fieldScopePolicyCode?: string | null;
}

export interface EmployeePermissionProfileDoc extends Document {
  employeeId: mongoose.Types.ObjectId;
  roleIds: mongoose.Types.ObjectId[];
  overrides: PermissionOverrideDoc[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PermissionOverrideSchema = new Schema<PermissionOverrideDoc>(
  {
    permissionCode: { type: String, required: true },
    status: { type: String, enum: ["ALLOW", "BLOCK"], required: true },
    dataScopePolicyCode: { type: String, default: null },
    fieldScopePolicyCode: { type: String, default: null }
  },
  { _id: false }
);

const EmployeePermissionProfileSchema = new Schema<EmployeePermissionProfileDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: "user_info", required: true },
    roleIds: [{ type: Schema.Types.ObjectId, ref: "permission_role" }],
    overrides: { type: [PermissionOverrideSchema], default: [] },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
);

EmployeePermissionProfileSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<EmployeePermissionProfileDoc>(
  "employee_permission_profile",
  EmployeePermissionProfileSchema
);
