const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const LaborContractModel = new mongoose.Schema(
  {
    id_user_info: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user_info",
      required: true,
    },
    contract_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    start_date: {
      type: Date,
      required: true,
    },
    end_date: {
      type: Date,
      default: null, // Có thể null nếu hợp đồng không thời hạn
    },
    type: {
      type: String,
      enum: [
        "probation",              // Thử việc
        "fixed_term",             // Chính thức xác định thời hạn
        "indefinite_term",        // Chính thức không xác định thời hạn
        "other",                  // Phòng khi thêm loại đặc biệt
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "terminated"],
      default: "active",
    },
    file_url: {
      type: String, // link đến file scan PDF
      required: true,
    },
    note: {
      type: String,
      trim: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "account",
    },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  }
);

module.exports = mongoose.model("labor_contract", LaborContractModel);
