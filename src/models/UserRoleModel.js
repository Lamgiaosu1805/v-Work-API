const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const UserRoleModel = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    role: { type: mongoose.Schema.Types.ObjectId, ref: "role", required: true },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

UserRoleModel.index({ user: 1, role: 1 }, { unique: true });

module.exports = mongoose.model("user_role", UserRoleModel);
