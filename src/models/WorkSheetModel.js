const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const WorkSheetModel = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user_info",
      required: true
    },
    date: { type: Date, required: true },
    shifts: [{ type: mongoose.Schema.Types.ObjectId, ref: "shift" }],
    check_in: { type: Date, default: null },
    check_out: { type: Date, default: null },
    minutes_late: { type: Number, default: 0 },
    minute_early: { type: Number, default: 0 },
    work_unit: { type: Number, default: null },
    penalty_amount: { type: Number, default: 0 },
    // Snapshot lần sửa tay gần nhất (vd adminEditWorksheet) — không phải lịch sử đầy đủ
    edited_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
    edited_at: { type: Date, default: null },
    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

WorkSheetModel.index({ user_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("work_sheet", WorkSheetModel);
