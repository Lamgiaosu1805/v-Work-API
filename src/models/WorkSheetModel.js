const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const WorkSheetModel = new mongoose.Schema(
    {
        user_id: { type: mongoose.ObjectId, ref: "user_info" },
        date: Date,
        shifts: [{ type: mongoose.ObjectId, ref: "shift" }],  // ca hôm đó
        status: { type: String, enum: ["pending", "present", "absent", "leave"], default: "pending" },
        check_in: Date,
        check_out: Date,
        minutes_late: { type: Number, default: 0 },
        minute_early: { type: Number, default: 0 },
        mergedShift: { type: Boolean, default: false }, // true nếu là 1 ngày full (2 ca hoặc hành chính)
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("work_sheet", WorkSheetModel);