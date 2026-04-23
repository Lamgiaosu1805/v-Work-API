const CustomerModel = require("../models/CustomerModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const SaleKpiModel = require("../models/SaleKpiModel");
const UserInfoModel = require("../models/UserInfoModel");
const AppModel = require("../models/AppModel");

const CustomerController = {
    upsert: async (req, res) => {
        try {
            const {
                app_code,
                phone_number,
                external_id,
                ref_code,  // format: "0901234567-NV001"
                source,

                // Thông tin ekyc — chỉ có khi ekyc xong
                full_name,
                date_of_birth,
                gender,
                id_number,
                id_type,
                id_issued_date,
                id_issued_place,
                address,
                province,
                district,
                ward,
                id_front_url,
                id_back_url,
                selfie_url,
            } = req.body;

            // Validate bắt buộc
            if (!app_code || !phone_number || !external_id) {
                return res.status(400).json({
                    message: "Thiếu app_code, phone_number hoặc external_id",
                });
            }

            // Tìm app
            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            // Parse ref_code format "0901234567-NV001"
            // Tìm sale khớp cả phone_number lẫn ma_nv
            let referred_by = null;
            let matched_ref_code = null;
            if (ref_code) {
                const parts = ref_code.split("-");
                if (parts.length === 2) {
                    const [salePhone, saleMaNv] = parts;
                    const sale = await UserInfoModel.findOne({
                        phone_number: salePhone,
                        ma_nv: saleMaNv,
                    });
                    if (sale) {
                        referred_by = sale._id;
                        matched_ref_code = ref_code;
                    }
                }
            }

            // Kiểm tra có thông tin ekyc không
            const hasKycInfo = !!(full_name || id_number);

            // Tìm customer đã tồn tại chưa
            const existingCustomer = await CustomerModel.findOne({
                app_id: app._id,
                phone_number,
            });

            // ============================================
            // TRƯỜNG HỢP 1: Chưa có → tạo mới (đăng ký)
            // ============================================
            if (!existingCustomer) {
                const customer = await CustomerModel.create({
                    app_id: app._id,
                    phone_number,
                    external_id,
                    ref_code: matched_ref_code ?? null,
                    referred_by,
                    source: {
                        type: source ?? "direct",
                        scanned_at: source === "qr_scan" ? new Date() : null,
                    },
                    status: hasKycInfo ? "kyc_verified" : "registered",
                    identity: hasKycInfo ? {
                        full_name,
                        date_of_birth,
                        gender,
                        id_number,
                        id_type,
                        id_issued_date,
                        id_issued_place,
                        address,
                        province,
                        district,
                        ward,
                        id_front_url,
                        id_back_url,
                        selfie_url,
                        verified_at: new Date(),
                        verified_by: "auto",
                    } : {},
                });

                if (referred_by) {
                    await CustomerInteractionModel.create({
                        app_id: app._id,
                        customer_id: customer._id,
                        sale_id: referred_by,
                        type: "note",
                        content: `Khách hàng đăng ký qua mã giới thiệu ${matched_ref_code}`,
                        result: null,
                    });

                    const now = new Date();
                    await SaleKpiModel.findOneAndUpdate(
                        {
                            app_id: app._id,
                            sale_id: referred_by,
                            "period.month": now.getMonth() + 1,
                            "period.year": now.getFullYear(),
                        },
                        { $inc: { "actuals.new_customers": 1 } },
                        { upsert: true, new: true }
                    );
                }

                return res.status(201).json({
                    message: "Tạo khách hàng thành công",
                    customer,
                });
            }

            // ============================================
            // TRƯỜNG HỢP 2: Đã có → update (sau ekyc)
            // ============================================
            const isFirstTimeKyc =
                existingCustomer.status === "registered" ||
                existingCustomer.status === "kyc_pending";

            const updateData = {};

            if (hasKycInfo) {
                updateData.status = "kyc_verified";
                updateData.identity = {
                    full_name,
                    date_of_birth,
                    gender,
                    id_number,
                    id_type,
                    id_issued_date,
                    id_issued_place,
                    address,
                    province,
                    district,
                    ward,
                    id_front_url,
                    id_back_url,
                    selfie_url,
                    verified_at: new Date(),
                    verified_by: "auto",
                };
            }

            // Nếu lần đầu có ref_code hợp lệ mà trước đó chưa có → ghi nhận sale
            if (referred_by && !existingCustomer.referred_by) {
                updateData.referred_by = referred_by;
                updateData.ref_code = matched_ref_code;
            }

            const updatedCustomer = await CustomerModel.findByIdAndUpdate(
                existingCustomer._id,
                { $set: updateData },
                { new: true }
            );

            // Sale để ghi interaction + KPI
            // Ưu tiên referred_by mới (nếu vừa được gán), không thì dùng cái cũ
            const saleId = referred_by && !existingCustomer.referred_by
                ? referred_by
                : existingCustomer.referred_by;

            if (saleId) {
                if (hasKycInfo) {
                    await CustomerInteractionModel.create({
                        app_id: app._id,
                        customer_id: existingCustomer._id,
                        sale_id: saleId,
                        type: "kyc_updated",
                        content: `Khách hàng eKYC thành công`,
                        result: null,
                        metadata: {
                            old_status: existingCustomer.status,
                            new_status: "kyc_verified",
                        },
                    });

                    if (isFirstTimeKyc) {
                        const now = new Date();
                        await SaleKpiModel.findOneAndUpdate(
                            {
                                app_id: app._id,
                                sale_id: saleId,
                                "period.month": now.getMonth() + 1,
                                "period.year": now.getFullYear(),
                            },
                            { $inc: { "actuals.kyc_verified": 1 } },
                            { upsert: true, new: true }
                        );
                    }
                }

                // Nếu vừa được gán sale mới (chưa có trước đó) → log + cộng KPI new_customers
                if (referred_by && !existingCustomer.referred_by) {
                    await CustomerInteractionModel.create({
                        app_id: app._id,
                        customer_id: existingCustomer._id,
                        sale_id: referred_by,
                        type: "note",
                        content: `Khách hàng được gán cho nhân viên qua mã ${matched_ref_code}`,
                        result: null,
                    });

                    const now = new Date();
                    await SaleKpiModel.findOneAndUpdate(
                        {
                            app_id: app._id,
                            sale_id: referred_by,
                            "period.month": now.getMonth() + 1,
                            "period.year": now.getFullYear(),
                        },
                        { $inc: { "actuals.new_customers": 1 } },
                        { upsert: true, new: true }
                    );
                }
            }

            return res.status(200).json({
                message: "Cập nhật khách hàng thành công",
                customer: updatedCustomer,
            });
        } catch (error) {
            console.error("Error in upsert:", error);
            return res.status(500).json({
                message: "Internal server error",
                error: error.message,
            });
        }
    },
};

module.exports = CustomerController;