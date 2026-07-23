const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const CustomerModel = new mongoose.Schema(
  {
    // === ĐỊNH DANH APP ===
    app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true },

    // === ĐỊNH DANH CƠ BẢN (có ngay khi đăng ký) ===
    phone_number: { type: String, required: true },
    ref_code: { type: String, default: null },
    referred_by: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
    agent_id: { type: mongoose.Schema.Types.ObjectId, ref: "agent", default: null },
    source_type: {
      type: String,
      enum: ["sale", "agent", "marketing"],
      default: "marketing"
    },
    status: {
      type: String,
      enum: [
        "registered",
        "kyc_pending",
        "kyc_verified",
        "kyc_rejected",
        "active",
        "inactive",
        "blocked"
      ],
      default: "registered"
    },

    // === THÔNG TIN ĐỊNH DANH (có sau khi ekyc) ===
    identity: {
      full_name: { type: String, default: null },
      date_of_birth: { type: Date, default: null },
      gender: { type: String, enum: ["male", "female", "other"], default: null },
      id_number: { type: String, default: null },
      id_type: { type: String, enum: ["cccd", "cmnd", "passport"], default: null },
      id_issued_date: { type: Date, default: null },
      id_issued_place: { type: String, default: null },
      address: { type: String, default: null },
      province: { type: String, default: null },
      district: { type: String, default: null },
      ward: { type: String, default: null },
      id_front_url: { type: String, default: null },
      id_back_url: { type: String, default: null },
      selfie_url: { type: String, default: null },
      verified_at: { type: Date, default: null },
      verified_by: { type: String, enum: ["auto", "manual"], default: null }
    },

    // === TÀI KHOẢN NGÂN HÀNG (có sau ekyc) ===
    bank_accounts: [
      {
        bank_name: { type: String },
        bank_code: { type: String },
        account_number: { type: String },
        account_name: { type: String },
        is_default: { type: Boolean, default: false },
        verified_at: { type: Date, default: null }
      }
    ],

    // === LIÊN KẾT HỆ THỐNG ĐẦU TƯ ===
    external_id: { type: String, default: null },

    // === HOA HỒNG ===
    referred_at: { type: Date, default: null },
    // Thời hạn để sale gửi yêu cầu nhận khách (tính từ lúc đăng ký, theo giờ làm việc)
    claim_window_until: { type: Date, default: null },
    cif_commission: {
      amount: { type: Number, default: 0 },
      sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
      granted_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
      granted_at: { type: Date, default: null }
    },
    ekyc_commission: {
      amount: { type: Number, default: 0 },
      sale_id: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
      granted_by: { type: mongoose.Schema.Types.ObjectId, ref: "account", default: null },
      granted_at: { type: Date, default: null }
    },

    registeredAt: { type: Date, required: true, default: Date.now },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
  }
);

CustomerModel.index({ app_id: 1, phone_number: 1 }, { unique: true });
CustomerModel.index({ "identity.verified_at": 1, createdAt: 1 });
CustomerModel.index({ referred_by: 1, createdAt: -1 });
CustomerModel.index({ registeredAt: -1 });

module.exports = mongoose.model("customer", CustomerModel);
