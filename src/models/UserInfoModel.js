const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const UserInfoModel = new mongoose.Schema(
  {
    full_name: { type: String, required: true },
    cccd: { type: String, required: true },
    phone_number: { type: String, required: true },
    sex: { type: Number, required: true }, // 0: Nữ, 1: Nam, 2: Khác
    date_of_birth: { type: Date, required: true },
    address: { type: String, required: true },
    tinh_trang_hon_nhan: { type: Number, required: true }, // 0: Độc thân, 1: Đã kết hôn, 2: Khác
    id_account: { type: mongoose.Schema.Types.ObjectId, ref: 'account', required: true },
    ma_nv: { type: String, required: true, unique: true },
    // ✅ Thêm trường này
    employment_type: {
      type: String,
      enum: ["fulltime", "parttime"],
      default: "fulltime",
    },
    ...BaseSchema.obj,
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject,
  }
);

module.exports = mongoose.model("user_info", UserInfoModel);