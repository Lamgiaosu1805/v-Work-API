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
    getMyCustomersAsAgent: async (req, res) => {
        try {
            const {
                page = 1,
                limit = 20,
                status,
                search,
                app_code,
                from_date,
                to_date,
                agent_code, // mã đại lý — bên hệ thống đầu tư truyền lên
            } = req.query;

            if (!agent_code || !app_code) {
                return res.status(400).json({ message: "Thiếu agent_code hoặc app_code" });
            }

            // Tìm app
            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            // Tìm agent theo agent_code + app_id
            const agent = await AgentModel.findOne({
                app_id: app._id,
                agent_code,
                is_active: true,
            });
            if (!agent) {
                return res.status(404).json({ message: "Đại lý không tồn tại hoặc đã bị khóa" });
            }

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter theo agent_id
            const filter = {
                app_id: app._id,
                agent_id: agent._id,
            };

            if (status) {
                filter.status = status;
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
                    .select("-identity.id_front_url -identity.id_back_url -identity.selfie_url")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                CustomerModel.countDocuments(filter),
            ]);

            return res.status(200).json({
                message: "Lấy danh sách khách hàng của đại lý thành công",
                agent: {
                    agent_code: agent.agent_code,
                    full_name: agent.full_name,
                    phone_number: agent.phone_number,
                },
                data: customers,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in getMyCustomersAsAgent:", error);
            return res.status(500).json({
                message: "Internal server error",
                error: error.message,
            });
        }
    },
    // GET /customers/my-info
    getMyInfo: async (req, res) => {
        try {
            const {
                app_code,
                external_id, // userId bên hệ thống đầu tư
            } = req.query;

            if (!app_code || !external_id) {
                return res.status(400).json({ message: "Thiếu app_code hoặc external_id" });
            }

            // Tìm app
            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            // Tìm customer theo external_id + app_id
            const customer = await CustomerModel.findOne({
                app_id: app._id,
                external_id,
            })
                .select("-identity.id_front_url -identity.id_back_url -identity.selfie_url")
                .populate("app_id", "name code");

            if (!customer) {
                return res.status(404).json({ message: "Không tìm thấy thông tin khách hàng" });
            }

            // Lấy thông tin sale nếu có
            let sale_info = null;
            if (customer.referred_by) {
                const sale = await UserInfoModel.findById(customer.referred_by)
                    .select("full_name phone_number ma_nv");
                if (sale) {
                    sale_info = {
                        ma_nv: sale.ma_nv,
                        full_name: sale.full_name,
                        phone_number: sale.phone_number,
                    };
                }
            }

            // Lấy thông tin đại lý nếu có
            let agent_info = null;
            if (customer.agent_id) {
                const agent = await AgentModel.findById(customer.agent_id)
                    .select("agent_code full_name phone_number email");
                if (agent) {
                    agent_info = {
                        agent_code: agent.agent_code,
                        full_name: agent.full_name,
                        phone_number: agent.phone_number,
                        email: agent.email,
                    };
                }
            }

            return res.status(200).json({
                message: "Lấy thông tin khách hàng thành công",
                data: {
                    customer_id: customer._id,
                    phone_number: customer.phone_number,
                    external_id: customer.external_id,
                    status: customer.status,
                    source_type: customer.source_type,
                    ref_code: customer.ref_code,
                    identity: customer.identity,
                    app: customer.app_id,
                    // Người chăm sóc
                    care_by: {
                        type: customer.source_type, // "sale" | "agent" | "marketing"
                        sale: sale_info,            // null nếu không có sale
                        agent: agent_info,          // null nếu không có agent
                    },
                    createdAt: customer.createdAt,
                    updatedAt: customer.updatedAt,
                },
            });
        } catch (error) {
            console.error("Error in getMyInfo:", error);
            return res.status(500).json({
                message: "Internal server error",
                error: error.message,
            });
        }
    },
    // POST /customers/apply-referral
    applyReferral: async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const {
                app_code,
                external_id,
                ref_code,
            } = req.body;

            if (!app_code || !external_id || !ref_code) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "Thiếu app_code, external_id hoặc ref_code" });
            }

            // Tìm app
            const app = await AppModel.findOne({ code: app_code, is_active: true }).session(session);
            if (!app) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            // Tìm customer theo external_id + app_id
            const customer = await CustomerModel.findOne({
                app_id: app._id,
                external_id,
            }).session(session);

            if (!customer) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy khách hàng" });
            }

            // Kiểm tra đã có người chăm sóc chưa
            if (customer.referred_by || customer.agent_id) {
                await session.abortTransaction();
                session.endSession();
                return res.status(409).json({
                    message: "Khách hàng đã có người chăm sóc, không thể thay đổi",
                    care_by: {
                        type: customer.source_type,
                        ref_code: customer.ref_code,
                    },
                });
            }

            // ================================================
            // DETECT mã giới thiệu theo thứ tự ưu tiên
            // ================================================
            let referred_by = null;
            let agent_id = null;
            let matched_ref_code = null;

            // Ưu tiên 1: Format "sđt-maNV" → Sale nội bộ CRM
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

            // Ưu tiên 2: Tìm agent_code
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

            // Không tìm thấy ai khớp
            if (!referred_by && !agent_id) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({
                    message: "Mã giới thiệu không hợp lệ hoặc không tìm thấy người giới thiệu",
                });
            }

            const source_type = referred_by ? "sale" : "agent";

            // Cập nhật customer
            await CustomerModel.findByIdAndUpdate(
                customer._id,
                {
                    $set: {
                        referred_by: referred_by ?? null,
                        agent_id: agent_id ?? null,
                        ref_code: matched_ref_code,
                        source_type,
                    },
                },
                { session }
            );

            // Ghi interaction log
            await CustomerInteractionModel.create([{
                app_id: app._id,
                customer_id: customer._id,
                sale_id: referred_by ?? null,
                agent_id: agent_id ?? null,
                type: "note",
                content: source_type === "agent"
                    ? `Khách hàng nhập mã giới thiệu đại lý ${matched_ref_code} (muộn)`
                    : `Khách hàng nhập mã giới thiệu sale ${matched_ref_code} (muộn)`,
                result: null,
            }], { session });

            await session.commitTransaction();
            session.endSession();

            return res.status(200).json({
                message: "Áp dụng mã giới thiệu thành công",
                data: {
                    external_id,
                    source_type,
                    ref_code: matched_ref_code,
                },
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Error in applyReferral:", error);
            return res.status(500).json({
                message: "Internal server error",
                error: error.message,
            });
        }
    },
};

module.exports = CustomerController;