const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const LeaveRequestModel = new mongoose.Schema(
    {
        userId: { type: mongoose.ObjectId, ref: "user_info" },
        dayOfWeek: Number,         // 1=Mon ... 7=Sun
        shifts: [{ type: mongoose.ObjectId, ref: "shift" }], // buổi làm việc hôm đó
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

module.exports = mongoose.model("leave_request", LeaveRequestModel);