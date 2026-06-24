const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const RolePermissionModel = new mongoose.Schema(
  {
    role: { type: mongoose.Schema.Types.ObjectId, ref: "role", required: true },
    permission: { type: mongoose.Schema.Types.ObjectId, ref: "permission", required: true },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

RolePermissionModel.index({ role: 1, permission: 1 }, { unique: true });

module.exports = mongoose.model("role_permission", RolePermissionModel);
