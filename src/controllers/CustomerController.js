const mongoose = require("mongoose");
const CustomerModel = require("../models/CustomerModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const UserInfoModel = require("../models/UserInfoModel");
const AppModel = require("../models/AppModel");
const AgentModel = require("../models/AgentModel");
const { createCifCommission, createEkycCommission } = require("../helpers/commissionCalculator");
const { computeClaimWindow } = require("../helpers/claimWindowHelper");

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
                const now = new Date();
                const newDoc = {
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
                        verified_at: now,
                        verified_by: "auto",
                    } : {},
                };

                // Tính cửa sổ thời gian để sale gửi yêu cầu nhận khách (chỉ với KH không có ref_code)
                if (!referred_by && !agent_id) {
                    newDoc.claim_window_until = computeClaimWindow(now);
                }

                // Gán HH CIF nếu đăng ký có mã sale
                if (referred_by) {
                    newDoc.referred_at = now;
                    newDoc.cif_commission = createCifCommission(referred_by);
                    // Nếu cùng lúc eKYC → HH eKYC luôn
                    if (hasKycInfo) {
                        newDoc.ekyc_commission = createEkycCommission(referred_by);
                    }
                }

                const [customer] = await CustomerModel.create([newDoc], { session });

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
            const now = new Date();
            const isFirstEkyc = hasKycInfo && !existingCustomer.identity?.verified_at;

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
                    verified_at: now,
                    verified_by: "auto",
                };
            }

            // Gán sale nếu chưa có
            if (referred_by && !existingCustomer.referred_by) {
                updateData.referred_by = referred_by;
                updateData.ref_code = matched_ref_code;
                updateData.source_type = "sale";
                updateData.referred_at = now;
                // HH CIF: sale được gán lần đầu
                if (!existingCustomer.cif_commission?.sale_id) {
                    updateData.cif_commission = createCifCommission(referred_by);
                }
                // Nếu cùng lúc eKYC → HH eKYC luôn
                if (isFirstEkyc && !existingCustomer.ekyc_commission?.sale_id) {
                    updateData.ekyc_commission = createEkycCommission(referred_by);
                }
            } else if (isFirstEkyc && existingCustomer.referred_by && existingCustomer.referred_at) {
                // eKYC lần đầu, đã có sale từ trước → HH eKYC tự động
                if (!existingCustomer.ekyc_commission?.sale_id) {
                    updateData.ekyc_commission = createEkycCommission(existingCustomer.referred_by);
                }
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
    // POST /customers/apply-referral — ĐÃ VÔ HIỆU HÓA
    // Khách không thể tự nhập mã giới thiệu sau khi đăng ký.
    // Mọi trường hợp cần gán sale → liên hệ Admin/Manager để phân khách hoặc chuyển sale.
    applyReferral: async (req, res) => {
        return res.status(410).json({
            message: "Tính năng nhập mã giới thiệu sau đăng ký đã bị vô hiệu hóa. Vui lòng liên hệ Admin hoặc Manager để được hỗ trợ gán mã giới thiệu.",
        });
    },

    // POST /customers/apply-referral — ORIGINAL (disabled above)
    _applyReferral_disabled: async (req, res) => {
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
            const applyUpdate = {
                referred_by: referred_by ?? null,
                agent_id: agent_id ?? null,
                ref_code: matched_ref_code,
                source_type,
            };

            // Gán referred_at và HH CIF khi sale nhập mã muộn
            if (referred_by) {
                applyUpdate.referred_at = new Date();
                if (!customer.cif_commission?.sale_id) {
                    applyUpdate.cif_commission = createCifCommission(referred_by);
                }
                // Không tự grant eKYC HH — nếu khách đã eKYC trước khi nhập mã
                // thì referred_at > verified_at → không tính theo quy tắc
            }

            await CustomerModel.findByIdAndUpdate(
                customer._id,
                { $set: applyUpdate },
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
    // GET /customers/all — Admin xem toàn bộ khách hàng
    getAll: async (req, res) => {
        try {
            const {
                page = 1,
                limit = 20,
                status,
                search,
                app_code,
                source_type,    // "sale" | "agent" | "marketing"
                from_date,
                to_date,
            } = req.query;

            const skip = (Number(page) - 1) * Number(limit);

            const filter = {};

            if (status) filter.status = status;
            if (source_type) filter.source_type = source_type;

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
                    { external_id: { $regex: search, $options: "i" } },
                ];
            }

            const [customers, total] = await Promise.all([
                CustomerModel.find(filter)
                    .populate("app_id", "name code")
                    .populate("referred_by", "full_name phone_number ma_nv")
                    .populate("agent_id", "agent_code full_name phone_number")
                    .select("-identity.id_front_url -identity.id_back_url -identity.selfie_url")
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
            console.error("Error in getAll:", error);
            return res.status(500).json({
                message: "Internal server error",
                error: error.message,
            });
        }
    },
    // POST /customers/bulk-upsert
    bulkUpsert: async (req, res) => {
        try {
            const { app_code, customers } = req.body;

            if (!app_code || !Array.isArray(customers) || customers.length === 0) {
                return res.status(400).json({ message: "Thiếu app_code hoặc customers" });
            }

            if (customers.length > 500) {
                return res.status(400).json({ message: "Tối đa 500 khách hàng mỗi lần" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }

            const results = {
                total: customers.length,
                created: 0,
                skipped: 0,  // đã tồn tại → bỏ qua
                failed: [],
            };

            for (const item of customers) {
                try {
                    if (!item.phone_number || !item.external_id) {
                        results.failed.push({
                            external_id: item.external_id ?? null,
                            phone_number: item.phone_number ?? null,
                            reason: "Thiếu phone_number hoặc external_id",
                        });
                        continue;
                    }

                    // Kiểm tra đã tồn tại chưa theo phone_number
                    const existing = await CustomerModel.findOne({
                        app_id: app._id,
                        phone_number: item.phone_number,
                    });

                    if (existing) {
                        // Đã tồn tại → bỏ qua hoàn toàn, không ghi đè bất cứ thứ gì
                        results.skipped++;
                        continue;
                    }

                    // Chuyển đổi gender: 0 → "male", 1 → "female"
                    const genderMap = { 0: "male", 1: "female" };
                    const mappedGender = item.gender !== undefined && item.gender !== null
                        ? (genderMap[Number(item.gender)] ?? null)
                        : null;

                    // Tạo mới — source_type = "marketing" vì KH cũ chưa biết thuộc ai
                    await CustomerModel.create({
                        app_id: app._id,
                        phone_number: item.phone_number,
                        external_id: item.external_id,
                        ref_code: null,
                        referred_by: null,
                        agent_id: null,
                        source_type: "marketing",
                        status: item.is_kyc ? "kyc_verified" : "registered",
                        identity: item.is_kyc ? {
                            full_name: item.full_name ?? null,
                            date_of_birth: item.date_of_birth ?? null,
                            gender: mappedGender,
                            id_number: item.id_number ?? null,
                            id_type: item.id_type ?? null,
                            id_issued_date: item.id_issued_date ?? null,
                            id_issued_place: item.id_issued_place ?? null,
                            address: item.address ?? null,
                            province: item.province ?? null,
                            district: item.district ?? null,
                            ward: item.ward ?? null,
                            verified_at: new Date(),
                            verified_by: "auto",
                        } : {},
                    });

                    results.created++;
                } catch (err) {
                    results.failed.push({
                        external_id: item.external_id ?? null,
                        phone_number: item.phone_number ?? null,
                        reason: err.message,
                    });
                }
            }

            return res.status(200).json({
                message: "Đồng bộ khách hàng hoàn tất",
                results,
            });
        } catch (error) {
            console.error("Error in bulkUpsert:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
    // PATCH /customers/:id/reassign — Admin chuyển sale (có audit log, lý do bắt buộc)
    reassignCustomer: async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const { id: customer_id } = req.params;
            const {
                sale_user_info_id,
                reason,
            } = req.body;
            const accountId = req.account._id;

            if (!sale_user_info_id || !reason?.trim()) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "Thiếu sale_user_info_id hoặc reason" });
            }

            const customer = await CustomerModel.findOne({
                _id: customer_id,
                isDeleted: false,
            }).session(session);
            if (!customer) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy khách hàng" });
            }

            const newSale = await UserInfoModel.findById(sale_user_info_id).session(session);
            if (!newSale) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            const oldSaleId = customer.referred_by ?? null;
            let oldSaleName = null;
            if (oldSaleId) {
                const oldSale = await UserInfoModel.findById(oldSaleId).select("full_name ma_nv").session(session);
                oldSaleName = oldSale ? `${oldSale.full_name} (${oldSale.ma_nv})` : null;
            }

            const isEkycDone = !!customer.identity?.verified_at;

            const updateData = {
                referred_by: newSale._id,
                // Giữ nguyên source_type — reassign là thay sale quản lý, không re-evaluate nguồn gốc KH
                source_type: customer.source_type,
                ref_code: `${newSale.phone_number}-${newSale.ma_nv}`,
                // Giữ nguyên referred_at gốc nếu đã có, nếu chưa thì set mới
                ...(customer.referred_at ? {} : { referred_at: new Date() }),
                // Giữ nguyên cif_commission và ekyc_commission — HH sale cũ đã nhận vẫn thuộc về họ
                // Sale mới chỉ nhận HH cho hành động mới: eKYC HH (nếu KH chưa eKYC) sẽ auto-trigger sau,
                // investment HH cho gói đầu tư mới sẽ tự dùng referred_by mới
            };

            await CustomerModel.findByIdAndUpdate(
                customer._id,
                { $set: updateData },
                { session }
            );

            await CustomerInteractionModel.create([{
                app_id: customer.app_id,
                customer_id: customer._id,
                sale_id: newSale._id,
                agent_id: null,
                type: "reassigned",
                content: `Chuyển sale từ ${oldSaleName ?? "chưa có"} → ${newSale.full_name} (${newSale.ma_nv}). Lý do: ${reason}`,
                result: null,
                metadata: {
                    from_sale_id: oldSaleId,
                    to_sale_id: newSale._id,
                    reason,
                    assigned_by: accountId,
                },
            }], { session });

            await session.commitTransaction();
            session.endSession();

            return res.status(200).json({
                message: "Chuyển sale thành công",
                data: {
                    customer_id: customer._id,
                    from_sale: oldSaleName ?? "Chưa có sale",
                    to_sale: {
                        _id: newSale._id,
                        ma_nv: newSale.ma_nv,
                        full_name: newSale.full_name,
                    },
                },
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Error in reassignCustomer:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // POST /customers/:id/assign — Admin/Manager phân khách về cho sale
    assignCustomer: async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const { id: customer_id } = req.params;
            const {
                sale_user_info_id,
                confirm_sale_source = false,
            } = req.body;
            const accountId = req.account._id;

            if (!sale_user_info_id) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "Thiếu sale_user_info_id" });
            }

            const customer = await CustomerModel.findOne({
                _id: customer_id,
                isDeleted: false,
            }).session(session);
            if (!customer) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy khách hàng" });
            }

            if (customer.referred_by) {
                await session.abortTransaction();
                session.endSession();
                return res.status(409).json({ message: "Khách hàng đã có sale phụ trách, không thể gán lại" });
            }

            const sale = await UserInfoModel.findById(sale_user_info_id).session(session);
            if (!sale) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            const updateData = {
                referred_by: sale._id,
                // source_type chỉ đổi sang "sale" khi admin xác nhận KH này do sale giới thiệu
                // Ngược lại giữ nguyên "marketing" — admin chỉ gán để quản lý, không phải xác nhận nguồn
                source_type: confirm_sale_source ? "sale" : customer.source_type,
                ref_code: `${sale.phone_number}-${sale.ma_nv}`,
                referred_at: new Date(),
            };

            await CustomerModel.findByIdAndUpdate(
                customer._id,
                { $set: updateData },
                { session }
            );

            await CustomerInteractionModel.create([{
                app_id: customer.app_id,
                customer_id: customer._id,
                sale_id: sale._id,
                agent_id: null,
                type: "note",
                content: confirm_sale_source
                    ? `Xác nhận khách hàng do sale ${sale.full_name} (${sale.ma_nv}) giới thiệu — đổi nguồn sang Sale`
                    : `Phân khách về cho sale ${sale.full_name} (${sale.ma_nv}) để quản lý — nguồn giữ nguyên Marketing`,
                result: null,
                metadata: {
                    assigned_by: accountId,
                    confirm_sale_source,
                },
            }], { session });

            await session.commitTransaction();
            session.endSession();

            return res.status(200).json({
                message: "Phân khách thành công",
                data: {
                    customer_id: customer._id,
                    sale: {
                        _id: sale._id,
                        ma_nv: sale.ma_nv,
                        full_name: sale.full_name,
                    },
                },
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Error in assignCustomer:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = CustomerController;