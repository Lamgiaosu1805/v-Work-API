const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const HolidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    year: { type: Number, required: true },
    ...BaseSchema.obj,
  },
  { ...BaseSchema.options, collection: "holidays" },
);

HolidaySchema.index({ date: 1 });
HolidaySchema.index({ year: 1, isDeleted: 1 });

module.exports = mongoose.model("holiday", HolidaySchema);
