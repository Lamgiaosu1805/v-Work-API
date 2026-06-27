const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const PermissionModel = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    group: { type: String, default: "general" },
    description: { type: String, default: "" },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

module.exports = mongoose.model("permission", PermissionModel);
