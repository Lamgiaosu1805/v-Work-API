const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const AttendanceMachineMappingSchema = new mongoose.Schema(
  {
    machine_code: { type: String, required: true, trim: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", required: true },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
    collection: "attendance_machine_mappings",
  },
);

AttendanceMachineMappingSchema.index({ machine_code: 1 }, { unique: true });
AttendanceMachineMappingSchema.index({ user_id: 1 });

module.exports = mongoose.model("attendance_machine_mapping", AttendanceMachineMappingSchema);
