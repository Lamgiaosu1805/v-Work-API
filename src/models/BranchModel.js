const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const BranchModel = new mongoose.Schema(
  {
    branch_name: { type: String, required: true },
    branch_code: { type: String, required: true, unique: true },
    address: { type: String, default: "" },
    is_active: { type: Boolean, default: true },

    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  }
);

module.exports = mongoose.model("branch", BranchModel);
