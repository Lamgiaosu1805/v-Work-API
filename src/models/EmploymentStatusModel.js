const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const EmploymentStatusModel = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    accrues_annual_leave: { type: Boolean, default: false },
    can_use_annual_leave: { type: Boolean, default: false },
    retroactive_on_promote: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  },
);

module.exports = mongoose.model("employment_status", EmploymentStatusModel);
