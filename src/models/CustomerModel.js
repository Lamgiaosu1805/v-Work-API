const mongoose = require("mongoose");
const BaseSchema = require("./BaseSchema");

const CustomerModel = new mongoose.Schema(
    {
        // === ĐỊNH DANH APP ===
        app_id: { type: mongoose.Schema.Types.ObjectId, ref: "app", required: true }, // phân biệt từng app

        // === ĐỊNH DANH CƠ BẢN (có ngay khi đăng ký) ===
        phone_number: { type: String, required: true },
        ref_code: { type: String, default: null },
        referred_by: { type: mongoose.Schema.Types.ObjectId, ref: "user_info", default: null },
        source: {
            type: { type: String, enum: ["qr_scan", "direct", "manual"], default: "direct" },
            scanned_at: { type: Date, default: null },
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
                "blocked",
            ],
            default: "registered",
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
            verified_by: { type: String, enum: ["auto", "manual"], default: null },
        },

        // === TÀI KHOẢN NGÂN HÀNG (có sau ekyc) ===
        bank_accounts: [
            {
                bank_name: { type: String },
                bank_code: { type: String },
                account_number: { type: String },
                account_name: { type: String },
                is_default: { type: Boolean, default: false },
                verified_at: { type: Date, default: null },
            },
        ],

        // === LIÊN KẾT HỆ THỐNG ĐẦU TƯ ===
        external_id: { type: String, default: null },  // ID bên hệ thống đầu tư
        ...BaseSchema.obj,
    },
    {
        timestamps: BaseSchema.options.timestamps,
        toJSON: BaseSchema.options.toJSON,
        toObject: BaseSchema.options.toObject,
    }
);

// unique theo tổ hợp app_id + phone_number
// 1 sđt có thể đăng ký nhiều app nhưng không được trùng trong cùng 1 app
CustomerModel.index({ app_id: 1, phone_number: 1 }, { unique: true });

module.exports = mongoose.model("customer", CustomerModel);