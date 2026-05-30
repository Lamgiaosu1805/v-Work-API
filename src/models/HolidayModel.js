const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const HolidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    year: { type: Number, required: true },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
    collection: "holidays",
  },
);

HolidaySchema.index({ date: 1 });
HolidaySchema.index({ year: 1, isDeleted: 1 });

module.exports = mongoose.model("holiday", HolidaySchema);
