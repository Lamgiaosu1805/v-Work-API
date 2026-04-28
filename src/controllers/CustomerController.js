const mongoose = require("mongoose");
const CustomerModel = require("../models/CustomerModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const UserInfoModel = require("../models/UserInfoModel");
const AppModel = require("../models/AppModel");
const AgentModel = require("../models/AgentModel");

const CustomerController = {
    upsert: async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const {
                app_code,
                phone_number,
                external_id,
                ref_code,
                type,           // "sale" | "agent" | undefined

                // Thông tin ekyc
                full_name,
                date_of_birth,
                gender,         // 0: Nam, 1: Nữ
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

            if (!app_code || !phone_number || !external_id) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    message: "Thiếu app_code, phone_number hoặc external_id",
                });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true }).session(session);
            if (!app) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            // Chuyển đổi gender: 0 → "male", 1 → "female"
            const genderMap = { 0: "male", 1: "female" };
            const mappedGender = gender !== undefined && gender !== null
                ? (genderMap[Number(gender)] ?? null)
                : null;

            // Parse ref_code theo type
            let referred_by = null;
            let agent_id = null;
            let matched_ref_code = null;

            if (ref_code) {
                if (type === "agent") {
                    // Biết chắc là agent → tìm theo agent_code
                    const agent = await AgentModel.findOne({
                        app_id: app._id,
                        agent_code: ref_code,
                        is_active: true,
                    }).session(session);
                    if (agent) {
                        agent_id = agent._id;
                        matched_ref_code = ref_code;
                    }

                } else if (type === "sale") {
                    // Biết chắc là sale → tìm theo "0901234567-NV001"
                    const parts = ref_code.split("-");
                    if (parts.length === 2) {
                        const [salePhone, saleMaNv] = parts;
                        const sale = await UserInfoModel.findOne({
                            phone_number: salePhone,
                            ma_nv: saleMaNv,
                        }).session(session);
                        if (sale) {
                            referred_by = sale._id;
                            matched_ref_code = ref_code;
                        }
                    }

                } else {
                    // Không có type → khách tự nhập mã
                    // Thử tìm sale trước (format "0901234567-NV001")
                    const parts = ref_code.split("-");
                    if (parts.length === 2) {
                        const [salePhone, saleMaNv] = parts;
                        const sale = await UserInfoModel.findOne({
                            phone_number: salePhone,
                            ma_nv: saleMaNv,
                        }).session(session);
                        if (sale) {
                            referred_by = sale._id;
                            matched_ref_code = ref_code;
                        }
                    }

                    // Không tìm thấy sale → thử tìm agent
                    if (!referred_by) {
                        const agent = await AgentModel.findOne({
                            app_id: app._id,
                            agent_code: ref_code,
                            is_active: true,
                        }).session(session);
                        if (agent) {
                            agent_id = agent._id;
                            matched_ref_code = ref_code;
                        }
                    }
                    // Cả 2 không khớp → marketing
                }
            }

            // Xác định source_type
            const source_type = referred_by
                ? "sale"
                : agent_id
                    ? "agent"
                    : "marketing";

            const hasKycInfo = !!(full_name || id_number);

            const existingCustomer = await CustomerModel.findOne({
                app_id: app._id,
                phone_number,
            }).session(session);

            // ============================================
            // TRƯỜNG HỢP 1: Chưa có → tạo mới
            // ============================================
            if (!existingCustomer) {
                const [customer] = await CustomerModel.create([{
                    app_id: app._id,
                    phone_number,
                    external_id,
                    ref_code: matched_ref_code ?? null,
                    referred_by,
                    agent_id,
                    source_type,
                    status: hasKycInfo ? "kyc_verified" : "registered",
                    identity: hasKycInfo ? {
                        full_name,
                        date_of_birth,
                        gender: mappedGender,
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
                }], { session });

                // Ghi interaction log nếu có sale hoặc agent
                if (referred_by || agent_id) {
                    await CustomerInteractionModel.create([{
                        app_id: app._id,
                        customer_id: customer._id,
                        sale_id: referred_by ?? null,
                        agent_id: agent_id ?? null,
                        type: "note",
                        content: source_type === "agent"
                            ? `Khách hàng đăng ký qua mã đại lý ${matched_ref_code}`
                            : `Khách hàng đăng ký qua mã giới thiệu ${matched_ref_code}`,
                        result: null,
                    }], { session });
                }

                await session.commitTransaction();
                session.endSession();

                return res.status(201).json({
                    message: "Tạo khách hàng thành công",
                    customer,
                });
            }

            // ============================================
            // TRƯỜNG HỢP 2: Đã có → update
            // ============================================
            const updateData = {};

            // Update ekyc nếu có
            if (hasKycInfo) {
                updateData.status = "kyc_verified";
                updateData.identity = {
                    full_name,
                    date_of_birth,
                    gender: mappedGender,
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

            // Gán sale nếu chưa có
            if (referred_by && !existingCustomer.referred_by) {
                updateData.referred_by = referred_by;
                updateData.ref_code = matched_ref_code;
                updateData.source_type = "sale";
            }

            // Gán agent nếu chưa có
            if (agent_id && !existingCustomer.agent_id) {
                updateData.agent_id = agent_id;
                updateData.ref_code = matched_ref_code;
                updateData.source_type = "agent";
            }

            const updatedCustomer = await CustomerModel.findByIdAndUpdate(
                existingCustomer._id,
                { $set: updateData },
                { new: true, session }
            );

            // Ghi interaction log
            const careId = referred_by ?? agent_id ?? null;
            if (careId) {
                if (hasKycInfo) {
                    await CustomerInteractionModel.create([{
                        app_id: app._id,
                        customer_id: existingCustomer._id,
                        sale_id: source_type === "sale" ? careId : null,
                        agent_id: source_type === "agent" ? careId : null,
                        type: "kyc_updated",
                        content: `Khách hàng eKYC thành công`,
                        result: null,
                        metadata: {
                            old_status: existingCustomer.status,
                            new_status: "kyc_verified",
                        },
                    }], { session });
                }

                const isNewAssignment =
                    (referred_by && !existingCustomer.referred_by) ||
                    (agent_id && !existingCustomer.agent_id);

                if (isNewAssignment) {
                    await CustomerInteractionModel.create([{
                        app_id: app._id,
                        customer_id: existingCustomer._id,
                        sale_id: source_type === "sale" ? careId : null,
                        agent_id: source_type === "agent" ? careId : null,
                        type: "note",
                        content: source_type === "agent"
                            ? `Khách hàng được gán cho đại lý qua mã ${matched_ref_code}`
                            : `Khách hàng được gán cho nhân viên qua mã ${matched_ref_code}`,
                        result: null,
                    }], { session });
                }
            }

            await session.commitTransaction();
            session.endSession();

            return res.status(200).json({
                message: "Cập nhật khách hàng thành công",
                customer: updatedCustomer,
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Error in upsert:", error);
            return res.status(500).json({
                message: "Internal server error",
                error: error.message,
            });
        }
    },
    getMyCustomers: async (req, res) => {
        try {
            const accountId = req.account._id;

            // Lấy thông tin sale từ account
            const sale = await UserInfoModel.findOne({ id_account: accountId });
            if (!sale) {
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            // Query params
            const {
                page = 1,
                limit = 20,
                status,         // lọc theo trạng thái
                search,         // tìm theo tên hoặc sđt
                app_code,       // lọc theo app
                from_date,      // lọc theo ngày đăng ký
                to_date,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter = { referred_by: sale._id };

            if (status) {
                filter.status = status;
            }

            if (app_code) {
                const app = await AppModel.findOne({ code: app_code, is_active: true });
                if (app) filter.app_id = app._id;
            }

            if (from_date || to_date) {
                filter.createdAt = {};
                if (from_date) filter.createdAt.$gte = new Date(from_date);
                if (to_date) filter.createdAt.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
            }

            if (search) {
                filter.$or = [
                    { phone_number: { $regex: search, $options: "i" } },
                    { "identity.full_name": { $regex: search, $options: "i" } },
                ];
            }

            const [customers, total] = await Promise.all([
                CustomerModel.find(filter)
                    .populate("app_id", "name code")
                    .select("-identity.id_front_url -identity.id_back_url -identity.selfie_url") // ẩn ảnh CCCD
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                CustomerModel.countDocuments(filter),
            ]);

            return res.status(200).json({
                message: "Lấy danh sách khách hàng thành công",
                data: customers,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in getMyCustomers:", error);
            return res.status(500).json({
                message: "Internal server error",
                error: error.message,
            });
        }
    },
};

module.exports = CustomerController;