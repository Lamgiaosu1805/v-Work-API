const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const ShiftModel = new mongoose.Schema(
    {
        name: { type: String, required: true },          // "Ca sáng", "Ca hành chính"
        start_time: { type: String, required: true },    // "08:00"
        end_time: { type: String, required: true },      // "12:00" or "17:00"
        late_allowance_minutes: { type: Number, default: 5 }, // 5 phút miễn trừ
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("shift", ShiftModel);