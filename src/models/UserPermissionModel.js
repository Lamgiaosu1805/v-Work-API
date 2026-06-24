const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");
const { PERMISSION_EFFECT_VALUES } = require("../constants");

const UserPermissionModel = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    permission: { type: mongoose.Schema.Types.ObjectId, ref: "permission", required: true },
    effect: { type: String, enum: PERMISSION_EFFECT_VALUES, required: true },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

UserPermissionModel.index({ user: 1, permission: 1 }, { unique: true });

module.exports = mongoose.model("user_permission", UserPermissionModel);
