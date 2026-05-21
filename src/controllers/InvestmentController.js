const mongoose = require("mongoose");
const InvestmentModel = require("../models/InvestmentModel");
const CustomerModel = require("../models/CustomerModel");
const AppModel = require("../models/AppModel");
const UserInfoModel = require("../models/UserInfoModel");
const AgentModel = require("../models/AgentModel");
const BranchModel = require("../models/BranchModel");
const UserDepartmentPositionModel = require("../models/UserDepartmentPositionModel");
const { calculateCommission, getTNCNRate, CIF_COMMISSION_AMOUNT, EKYC_COMMISSION_AMOUNT } = require("../helpers/commissionCalculator");

// ── Helpers cho getSalesChart ──────────────────────────────────────────────────
function getISOWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function buildPeriodRange(period) {
    const now = new Date();

    if (period === 'day') {
        const from = new Date(now);
        from.setDate(from.getDate() - 29);
        from.setHours(0, 0, 0, 0);
        const buckets = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
            buckets.push({ key, label });
        }
        return {
            from,
            buckets,
            groupId: { $dateToString: { format: '%Y-%m-%d', date: '$invested_at', timezone: 'Asia/Ho_Chi_Minh' } },
            formatKey: (id) => id,
        };
    }

    if (period === 'week') {
        const from = new Date(now);
        from.setDate(from.getDate() - 7 * 11);
        const dayOfWeek = from.getDay();
        from.setDate(from.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        from.setHours(0, 0, 0, 0);
        const buckets = [];
        const cur = new Date(from);
        for (let i = 0; i < 12; i++) {
            const weekEnd = new Date(cur);
            weekEnd.setDate(weekEnd.getDate() + 6);
            const iso = getISOWeek(cur);
            const key = `${cur.getFullYear()}-W${String(iso).padStart(2, '0')}`;
            const label = `${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}/${String(weekEnd.getMonth() + 1).padStart(2, '0')}`;
            buckets.push({ key, label });
            cur.setDate(cur.getDate() + 7);
        }
        return {
            from,
            buckets,
            groupId: { year: { $isoWeekYear: '$invested_at' }, week: { $isoWeek: '$invested_at' } },
            formatKey: (id) => `${id.year}-W${String(id.week).padStart(2, '0')}`,
        };
    }

    // month (default)
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const buckets = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = `Th ${d.getMonth() + 1}/${d.getFullYear()}`;
        buckets.push({ key, label });
    }
    return {
        from,
        buckets,
        groupId: { year: { $year: '$invested_at' }, month: { $month: '$invested_at' } },
        formatKey: (id) => `${id.year}-${String(id.month).padStart(2, '0')}`,
    };
}

const InvestmentController = {
    // POST /investments/upsert
    upsert: async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const {
                app_code,
                external_id,
                external_investment_id,
                product_name,
                amount,
                term_type,
                term_value,
                interest_rate,
                invested_at,
                maturity_at,
                status = "active",
            } = req.body;

            if (!app_code || !external_id || !external_investment_id
                || !product_name || !amount || !term_type || !term_value
                || !interest_rate || !invested_at || !maturity_at) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });
            }

            if (!["week", "month"].includes(term_type)) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ message: "term_type phải là 'week' hoặc 'month'" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true }).session(session);
            if (!app) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "App không tồn tại" });
            }

            const customer = await CustomerModel.findOne({
                app_id: app._id,
                external_id,
            }).session(session);
            if (!customer) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy khách hàng" });
            }

            // Đã tồn tại → chỉ update status
            const existing = await InvestmentModel.findOne({
                app_id: app._id,
                external_investment_id,
            }).session(session);

            if (existing) {
                existing.status = status;
                existing.maturity_at = maturity_at ?? existing.maturity_at;
                await existing.save({ session });
                await session.commitTransaction();
                session.endSession();
                return res.status(200).json({
                    message: "Cập nhật khoản đầu tư thành công",
                    investment: existing,
                });
            }

            // Kỳ hoa hồng = tháng đầu tư
            const investedDate = new Date(invested_at);
            const period_month = investedDate.getMonth() + 1;
            const period_year = investedDate.getFullYear();

            // Mặc định không có HH
            let commissionData = {
                receiver_type: null,
                sale_id: null,
                agent_id: null,
                period_month,
                period_year,
                commission_rate: 1.8,
                gross_amount: 0,
                tncn_rate: null,
                tncn_amount: 0,
                net_amount: 0,
                status: "none",
            };

            // Chỉ tính HH khi term_type = "month"
            if (term_type === "month") {
                if (customer.referred_by) {
                    const sale = await UserInfoModel.findById(customer.referred_by).session(session);
                    if (sale) {
                        const tncn_rate = getTNCNRate(sale.employment_type);
                        const calc = calculateCommission({ amount, term_months: term_value, tncn_rate });
                        commissionData = {
                            receiver_type: "sale",
                            sale_id: sale._id,
                            agent_id: null,
                            period_month,
                            period_year,
                            ...calc,
                            status: "pending",
                        };
                    }
                } else if (customer.agent_id) {
                    const calc = calculateCommission({ amount, term_months: term_value, tncn_rate: 10 });
                    commissionData = {
                        receiver_type: "agent",
                        sale_id: null,
                        agent_id: customer.agent_id,
                        period_month,
                        period_year,
                        ...calc,
                        status: "pending",
                    };
                }
            }

            const [investment] = await InvestmentModel.create([{
                app_id: app._id,
                customer_id: customer._id,
                external_investment_id,
                product_name,
                amount,
                term_type,
                term_value,
                interest_rate,
                invested_at,
                maturity_at,
                status,
                commission: commissionData,
            }], { session });

            await session.commitTransaction();
            session.endSession();

            return res.status(201).json({
                message: "Tạo khoản đầu tư và ghi nhận hoa hồng thành công",
                investment,
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Error in investment upsert:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /investments/my-commission
    // Sale nội bộ xem lịch sử HH dự kiến của mình
    getMyCommission: async (req, res) => {
        try {
            const accountId = req.account._id;
            const now = new Date();
            const {
                page = 1,
                limit = 20,
                month = now.getMonth() + 1, // default tháng hiện tại
                year = now.getFullYear(),    // default năm hiện tại
                app_code,
            } = req.query;

            const sale = await UserInfoModel.findOne({ id_account: accountId });
            if (!sale) {
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            const filter = {
                "commission.sale_id": sale._id,
                "commission.status": "pending",
                "commission.period_month": Number(month),
                "commission.period_year": Number(year),
            };

            if (app_code) {
                const app = await AppModel.findOne({ code: app_code, is_active: true });
                if (app) filter.app_id = app._id;
            }

            const skip = (Number(page) - 1) * Number(limit);

            const [investments, total] = await Promise.all([
                InvestmentModel.find(filter)
                    .populate({
                        path: "customer_id",
                        select: "phone_number identity.full_name",
                    })
                    .populate("app_id", "name code")
                    .select("product_name amount term_type term_value interest_rate invested_at maturity_at status commission createdAt")
                    .sort({ invested_at: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                InvestmentModel.countDocuments(filter),
            ]);

            const summary = await InvestmentModel.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        total_investment_amount: { $sum: "$amount" },
                        total_gross: { $sum: "$commission.gross_amount" },
                        total_tncn: { $sum: "$commission.tncn_amount" },
                        total_net: { $sum: "$commission.net_amount" },
                        count: { $sum: 1 },
                    },
                },
            ]);

            // HH CIF/eKYC trong cùng tháng/năm
            const startOfMonth = new Date(Number(year), Number(month) - 1, 1);
            const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

            const customerCommissions = await CustomerModel.find({
                $or: [
                    {
                        "cif_commission.sale_id": sale._id,
                        "cif_commission.granted_at": { $gte: startOfMonth, $lte: endOfMonth },
                    },
                    {
                        "ekyc_commission.sale_id": sale._id,
                        "ekyc_commission.granted_at": { $gte: startOfMonth, $lte: endOfMonth },
                    },
                ],
            }).select("phone_number external_id identity.full_name cif_commission ekyc_commission");

            const cifCount = customerCommissions.filter(
                (c) => c.cif_commission?.sale_id?.toString() === sale._id.toString() &&
                    c.cif_commission?.granted_at >= startOfMonth
            ).length;
            const ekycCount = customerCommissions.filter(
                (c) => c.ekyc_commission?.sale_id?.toString() === sale._id.toString() &&
                    c.ekyc_commission?.granted_at >= startOfMonth
            ).length;

            return res.status(200).json({
                message: "Lấy lịch sử hoa hồng thành công",
                period: {
                    month: Number(month),
                    year: Number(year),
                },
                summary: summary[0] ?? {
                    total_investment_amount: 0,
                    total_gross: 0,
                    total_tncn: 0,
                    total_net: 0,
                    count: 0,
                },
                customer_commission_summary: {
                    cif_count: cifCount,
                    cif_amount: cifCount * CIF_COMMISSION_AMOUNT,
                    ekyc_count: ekycCount,
                    ekyc_amount: ekycCount * EKYC_COMMISSION_AMOUNT,
                    total_amount: cifCount * CIF_COMMISSION_AMOUNT + ekycCount * EKYC_COMMISSION_AMOUNT,
                },
                customer_commissions: customerCommissions,
                data: investments,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in getMyCommission:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /investments/agent-commission?agent_code=AGT001&app_code=tikluy
    // Hệ thống đầu tư gọi để đại lý xem HH dự kiến
    getAgentCommission: async (req, res) => {
        try {
            const now = new Date();
            const {
                app_code,
                agent_code,
                page = 1,
                limit = 20,
                month = now.getMonth() + 1, // default tháng hiện tại
                year = now.getFullYear(),    // default năm hiện tại
            } = req.query;

            if (!app_code || !agent_code) {
                return res.status(400).json({ message: "Thiếu app_code hoặc agent_code" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }

            const agent = await AgentModel.findOne({
                app_id: app._id,
                agent_code,
                is_active: true,
            });
            if (!agent) {
                return res.status(404).json({ message: "Đại lý không tồn tại" });
            }

            const filter = {
                "commission.agent_id": agent._id,
                "commission.status": "pending",
                "commission.period_month": Number(month),
                "commission.period_year": Number(year),
            };

            const skip = (Number(page) - 1) * Number(limit);

            const [investments, total] = await Promise.all([
                InvestmentModel.find(filter)
                    .populate({
                        path: "customer_id",
                        select: "phone_number identity.full_name",
                    })
                    .select("product_name amount term_type term_value interest_rate invested_at maturity_at status commission createdAt")
                    .sort({ invested_at: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                InvestmentModel.countDocuments(filter),
            ]);

            const summary = await InvestmentModel.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        total_investment_amount: { $sum: "$amount" },
                        total_gross: { $sum: "$commission.gross_amount" },
                        total_tncn: { $sum: "$commission.tncn_amount" },
                        total_net: { $sum: "$commission.net_amount" },
                        count: { $sum: 1 },
                    },
                },
            ]);

            return res.status(200).json({
                message: "Lấy lịch sử hoa hồng đại lý thành công",
                period: {
                    month: Number(month),
                    year: Number(year),
                },
                agent: {
                    agent_code: agent.agent_code,
                    full_name: agent.full_name,
                },
                summary: summary[0] ?? {
                    total_investment_amount: 0,
                    total_gross: 0,
                    total_tncn: 0,
                    total_net: 0,
                    count: 0,
                },
                data: investments,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in getAgentCommission:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
    // GET /investments/list
    // Sale: chỉ thấy đầu tư của khách mình — Manager/Admin: thấy tất cả
    list: async (req, res) => {
        try {
            const { page = 1, limit = 20, status, date_from, date_to, q } = req.query;
            const account = req.account;
            const isManager = account.role === "admin" || account.role === "manager";

            const filter = {};

            // Sale chỉ xem investment của khách mình (qua commission.sale_id)
            if (!isManager) {
                const sale = await UserInfoModel.findOne({ id_account: account._id });
                if (!sale) return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
                filter["commission.sale_id"] = sale._id;
            }

            if (status) filter.status = status;

            if (date_from || date_to) {
                filter.invested_at = {};
                if (date_from) filter.invested_at.$gte = new Date(date_from);
                if (date_to) {
                    const to = new Date(date_to);
                    to.setHours(23, 59, 59, 999);
                    filter.invested_at.$lte = to;
                }
            }

            // Tìm kiếm theo số điện thoại hoặc tên khách
            if (q) {
                const matchedCustomers = await CustomerModel.find({
                    $or: [
                        { phone_number: { $regex: q.trim(), $options: "i" } },
                        { "identity.full_name": { $regex: q.trim(), $options: "i" } },
                    ],
                }).select("_id");
                filter.customer_id = { $in: matchedCustomers.map((c) => c._id) };
            }

            const skip = (Number(page) - 1) * Number(limit);

            const [investments, total] = await Promise.all([
                InvestmentModel.find(filter)
                    .populate({ path: "customer_id", select: "phone_number identity.full_name" })
                    .populate({ path: "commission.sale_id", select: "full_name ma_nv" })
                    .select("product_name amount term_type term_value interest_rate invested_at maturity_at status commission")
                    .sort({ invested_at: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                InvestmentModel.countDocuments(filter),
            ]);

            return res.status(200).json({
                message: "Lấy danh sách đầu tư thành công",
                data: investments,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in list investments:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // POST /investments/bulk-sync
    // Đồng bộ khoản đầu tư cũ — KHÔNG tính hoa hồng
    bulkSync: async (req, res) => {
        try {
            const { app_code, investments } = req.body;

            if (!app_code || !Array.isArray(investments) || investments.length === 0) {
                return res.status(400).json({ message: "Thiếu app_code hoặc investments" });
            }

            if (investments.length > 500) {
                return res.status(400).json({ message: "Tối đa 500 khoản đầu tư mỗi lần" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }

            const results = {
                total: investments.length,
                created: 0,
                skipped: 0,
                failed: [],
            };

            for (const item of investments) {
                try {
                    // Validate bắt buộc
                    if (!item.external_id || !item.external_investment_id
                        || !item.product_name || !item.amount
                        || !item.term_type || !item.term_value
                        || !item.interest_rate || !item.invested_at || !item.maturity_at) {
                        results.failed.push({
                            external_investment_id: item.external_investment_id ?? null,
                            reason: "Thiếu thông tin bắt buộc",
                        });
                        continue;
                    }

                    if (!["week", "month"].includes(item.term_type)) {
                        results.failed.push({
                            external_investment_id: item.external_investment_id,
                            reason: "term_type phải là 'week' hoặc 'month'",
                        });
                        continue;
                    }

                    // Kiểm tra đã tồn tại chưa
                    const existing = await InvestmentModel.findOne({
                        app_id: app._id,
                        external_investment_id: item.external_investment_id,
                    });

                    if (existing) {
                        results.skipped++;
                        continue;
                    }

                    // Tìm customer theo external_id
                    const customer = await CustomerModel.findOne({
                        app_id: app._id,
                        external_id: item.external_id,
                    });

                    if (!customer) {
                        results.failed.push({
                            external_investment_id: item.external_investment_id,
                            reason: `Không tìm thấy khách hàng với external_id: ${item.external_id}`,
                        });
                        continue;
                    }

                    // Kỳ hoa hồng — lưu theo tháng đầu tư nhưng không tính
                    const investedDate = new Date(item.invested_at);
                    const period_month = investedDate.getMonth() + 1;
                    const period_year = investedDate.getFullYear();

                    // Tạo khoản đầu tư — commission.status = "none" hoàn toàn
                    await InvestmentModel.create({
                        app_id: app._id,
                        customer_id: customer._id,
                        external_investment_id: item.external_investment_id,
                        product_name: item.product_name,
                        amount: item.amount,
                        term_type: item.term_type,
                        term_value: item.term_value,
                        interest_rate: item.interest_rate,
                        invested_at: new Date(item.invested_at),
                        maturity_at: new Date(item.maturity_at),
                        status: item.status ?? "active",
                        commission: {
                            receiver_type: null,
                            sale_id: null,
                            agent_id: null,
                            period_month,
                            period_year,
                            commission_rate: 0,
                            gross_amount: 0,
                            tncn_rate: null,
                            tncn_amount: 0,
                            net_amount: 0,
                            status: "none", // không tính hoa hồng
                        },
                    });

                    results.created++;
                } catch (err) {
                    results.failed.push({
                        external_investment_id: item.external_investment_id ?? null,
                        reason: err.message,
                    });
                }
            }

            return res.status(200).json({
                message: "Đồng bộ khoản đầu tư hoàn tất",
                results,
            });
        } catch (error) {
            console.error("Error in bulkSync:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /investments/sales-chart?period=day|week|month&branch_id=X
    // Attribution đi theo chain: investment.customer_id → customer.referred_by → sale
    // Không phụ thuộc commission.sale_id để bao gồm cả week investment
    getSalesChart: async (req, res) => {
        try {
            const { period = 'month', branch_id } = req.query;
            const { _id: accountId, role } = req.account;
            const isAdmin = role === 'admin';
            const isMgr = role === 'manager' && req.account.module_access.includes('crm');

            const { from, buckets, groupId, formatKey } = buildPeriodRange(period);

            let mode;
            const matchFilter = { invested_at: { $gte: from }, isDeleted: false };

            if (isAdmin) {
                mode = branch_id ? 'branch' : 'all';
                if (branch_id) {
                    const branchSaleIds = await UserInfoModel.distinct('_id', { branch_id: new mongoose.Types.ObjectId(branch_id), isDeleted: false });
                    const branchCustomerIds = await CustomerModel.distinct('_id', { referred_by: { $in: branchSaleIds }, isDeleted: false });
                    matchFilter.customer_id = { $in: branchCustomerIds };
                }
                // mode 'all': không lọc customer — tính toàn bộ hệ thống
            } else if (isMgr) {
                mode = 'department';
                const myInfo = await UserInfoModel.findOne({ id_account: accountId }).lean();
                if (!myInfo) return res.status(404).json({ message: 'Không tìm thấy thông tin nhân viên' });
                const myDeptIds = await UserDepartmentPositionModel.distinct('department', { user: myInfo._id, isDeleted: false });
                const deptSaleIds = await UserDepartmentPositionModel.distinct('user', { department: { $in: myDeptIds }, isDeleted: false });
                const deptCustomerIds = await CustomerModel.distinct('_id', { referred_by: { $in: deptSaleIds }, isDeleted: false });
                matchFilter.customer_id = { $in: deptCustomerIds };
            } else {
                mode = 'personal';
                const myInfo = await UserInfoModel.findOne({ id_account: accountId }).lean();
                if (!myInfo) return res.status(404).json({ message: 'Không tìm thấy thông tin nhân viên' });
                const myCustomerIds = await CustomerModel.distinct('_id', { referred_by: myInfo._id, isDeleted: false });
                matchFilter.customer_id = { $in: myCustomerIds };
            }

            // Chạy song song: time-series + tổng
            const [timeRaw, summaryRaw] = await Promise.all([
                InvestmentModel.aggregate([
                    { $match: matchFilter },
                    { $group: { _id: groupId, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
                ]),
                InvestmentModel.aggregate([
                    { $match: matchFilter },
                    { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
                ]),
            ]);

            // Fill buckets với 0 cho kỳ không có giao dịch
            const seriesMap = {};
            for (const r of timeRaw) seriesMap[formatKey(r._id)] = { amount: r.amount, count: r.count };
            const series = buckets.map(b => ({
                label: b.label,
                key: b.key,
                amount: seriesMap[b.key]?.amount ?? 0,
                count: seriesMap[b.key]?.count ?? 0,
            }));

            // Breakdown: per-branch (admin all) hoặc per-member (manager/branch)
            // Dùng customer.referred_by để resolve sale thay vì commission.sale_id
            let breakdown = [];

            if (mode === 'all') {
                const branchBreakRaw = await InvestmentModel.aggregate([
                    { $match: { invested_at: { $gte: from }, isDeleted: false } },
                    { $lookup: { from: 'customers', localField: 'customer_id', foreignField: '_id', as: '_c', pipeline: [{ $project: { referred_by: 1 } }] } },
                    { $addFields: { sale_ref: { $arrayElemAt: ['$_c.referred_by', 0] } } },
                    { $lookup: { from: 'user_infos', localField: 'sale_ref', foreignField: '_id', as: '_s', pipeline: [{ $project: { branch_id: 1 } }] } },
                    { $addFields: { branch_id: { $ifNull: [{ $arrayElemAt: ['$_s.branch_id', 0] }, null] } } },
                    { $group: { _id: '$branch_id', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
                    { $sort: { amount: -1 } },
                ]);
                const branchDocs = await BranchModel.find({ isDeleted: false }).lean();
                const branchMap = Object.fromEntries(branchDocs.map(b => [String(b._id), b.branch_name]));
                breakdown = branchBreakRaw.map(r => ({
                    id: r._id,
                    name: r._id ? (branchMap[String(r._id)] ?? 'Chi nhánh khác') : 'Chưa phân chi nhánh',
                    amount: r.amount,
                    count: r.count,
                }));
            } else if (mode === 'department' || mode === 'branch') {
                const memberRaw = await InvestmentModel.aggregate([
                    { $match: matchFilter },
                    { $lookup: { from: 'customers', localField: 'customer_id', foreignField: '_id', as: '_c', pipeline: [{ $project: { referred_by: 1 } }] } },
                    { $addFields: { sale_ref: { $arrayElemAt: ['$_c.referred_by', 0] } } },
                    { $group: { _id: '$sale_ref', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
                    { $sort: { amount: -1 } },
                    { $limit: 20 },
                ]);
                const infoIds = memberRaw.map(r => r._id).filter(Boolean);
                const infoDocs = await UserInfoModel.find({ _id: { $in: infoIds } }).select('_id full_name ma_nv').lean();
                const infoMap = Object.fromEntries(infoDocs.map(u => [String(u._id), u]));
                breakdown = memberRaw.map(r => {
                    const u = infoMap[String(r._id)];
                    return { id: r._id, name: u?.full_name ?? u?.ma_nv ?? 'Không xác định', amount: r.amount, count: r.count };
                });
            }

            return res.status(200).json({
                mode,
                period,
                series,
                breakdown,
                summary: { total_amount: summaryRaw[0]?.amount ?? 0, total_count: summaryRaw[0]?.count ?? 0 },
            });
        } catch (error) {
            console.error('Error in getSalesChart:', error);
            return res.status(500).json({ message: 'Internal server error', error: error.message });
        }
    },
};

// ── Cảnh báo đáo hạn ─────────────────────────────────────────────────────────
InvestmentController.getExpiring = async (req, res) => {
    try {
        const days = Math.min(parseInt(req.query.days) || 30, 90);
        const now = new Date();
        const until = new Date();
        until.setDate(until.getDate() + days);

        const match = { status: 'active', isDeleted: false, maturity_at: { $gte: now, $lte: until } };

        if (req.account.role === 'user') {
            const userInfo = await UserInfoModel.findOne({ id_account: req.account._id }).select('_id').lean();
            if (userInfo) match['commission.sale_id'] = userInfo._id;
        }

        const investments = await InvestmentModel.find(match)
            .populate({ path: 'customer_id', select: 'identity.full_name phone_number' })
            .select('product_name amount maturity_at customer_id commission')
            .sort({ maturity_at: 1 })
            .lean();

        const d7 = new Date(); d7.setDate(d7.getDate() + 7);
        const d14 = new Date(); d14.setDate(d14.getDate() + 14);

        // Với manager/admin: lấy thêm tên sale
        const saleIds = [...new Set(investments.map(i => i.commission?.sale_id).filter(Boolean).map(String))];
        const saleMap = {};
        if ((req.account.role === 'admin' || req.account.role === 'manager') && saleIds.length) {
            const sales = await UserInfoModel.find({ _id: { $in: saleIds } }).select('full_name').lean();
            sales.forEach(s => { saleMap[String(s._id)] = s.full_name; });
        }

        res.json({
            total: investments.length,
            days,
            investments: investments.map(i => {
                const daysLeft = Math.ceil((new Date(i.maturity_at) - now) / 86400000);
                return {
                    _id: i._id,
                    customer_name: i.customer_id?.identity?.full_name ?? i.customer_id?.phone_number ?? '—',
                    customer_phone: i.customer_id?.phone_number,
                    product_name: i.product_name,
                    amount: i.amount,
                    maturity_at: i.maturity_at,
                    days_left: daysLeft,
                    urgency: daysLeft <= 7 ? 'urgent' : daysLeft <= 14 ? 'warning' : 'normal',
                    sale_name: saleMap[String(i.commission?.sale_id)] ?? null,
                };
            }),
        });
    } catch (err) {
        console.log('getExpiring error:', err.message);
        res.status(500).json({ message: 'Lỗi lấy danh sách đáo hạn', error: err.message });
    }
};

// ── Leaderboard sale ──────────────────────────────────────────────────────────
InvestmentController.getLeaderboard = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const now = new Date();

        const from = period === 'week'
            ? (() => { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0,0,0,0); return d; })()
            : new Date(now.getFullYear(), now.getMonth(), 1);

        const matchInvestment = {
            isDeleted: false,
            invested_at: { $gte: from },
        };

        // Sale thường chỉ xem xếp hạng phòng ban mình — manager/admin xem tất cả
        if (req.account.role === 'user') {
            const userInfo = await UserInfoModel.findOne({ id_account: req.account._id }).select('_id').lean();
            const depts = await UserDepartmentPositionModel.find({ user: userInfo?._id }).select('department').lean();
            const deptIds = depts.map(d => d.department);
            const colleagues = await UserDepartmentPositionModel.find({ department: { $in: deptIds } }).select('user').lean();
            const colleagueIds = colleagues.map(c => c.user);
            const scopedCustomerIds = await CustomerModel.distinct('_id', { referred_by: { $in: colleagueIds }, isDeleted: false });
            matchInvestment.customer_id = { $in: scopedCustomerIds };
        }

        // Xếp hạng theo customer.referred_by thay vì commission.sale_id
        // để bao gồm cả week investment không sinh hoa hồng
        const rows = await InvestmentModel.aggregate([
            { $match: matchInvestment },
            { $lookup: { from: 'customers', localField: 'customer_id', foreignField: '_id', pipeline: [{ $project: { referred_by: 1 } }], as: '_c' } },
            { $addFields: { sale_ref: { $arrayElemAt: ['$_c.referred_by', 0] } } },
            { $match: { sale_ref: { $exists: true, $ne: null } } },
            { $group: { _id: '$sale_ref', total_amount: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $sort: { total_amount: -1 } },
            { $limit: 20 },
            { $lookup: { from: 'user_infos', localField: '_id', foreignField: '_id', pipeline: [{ $project: { full_name: 1 } }], as: 'info' } },
            { $project: { total_amount: 1, count: 1, sale_name: { $ifNull: [{ $arrayElemAt: ['$info.full_name', 0] }, 'Không rõ'] } } },
        ]);

        res.json({ period, from, leaderboard: rows });
    } catch (err) {
        console.log('getLeaderboard error:', err.message);
        res.status(500).json({ message: 'Lỗi lấy leaderboard', error: err.message });
    }
};

// ── Tỷ lệ chuyển đổi ─────────────────────────────────────────────────────────
InvestmentController.getConversion = async (req, res) => {
    try {
        const isManager = req.account.role === 'admin' || req.account.role === 'manager';

        if (!isManager) {
            // Phễu cá nhân — đếm theo quan hệ khách hàng (referred_by) thay vì commission.sale_id
            // để bao gồm cả week investment không sinh hoa hồng
            const userInfo = await UserInfoModel.findOne({ id_account: req.account._id }).select('_id').lean();
            const saleId = userInfo?._id;
            const myCustomerIds = await CustomerModel.distinct('_id', { referred_by: saleId, isDeleted: false });
            const [kycDone, investedIds] = await Promise.all([
                CustomerModel.countDocuments({ _id: { $in: myCustomerIds }, status: { $in: ['kyc_verified', 'active'] }, isDeleted: false }),
                InvestmentModel.distinct('customer_id', { customer_id: { $in: myCustomerIds }, isDeleted: false }),
            ]);
            return res.json({
                mode: 'personal',
                funnel: [
                    { label: 'Đã đăng ký', count: myCustomerIds.length },
                    { label: 'Đã KYC', count: kycDone },
                    { label: 'Đã đầu tư', count: investedIds.length },
                ],
            });
        }

        // Manager/admin: xếp hạng chuyển đổi theo sale
        // Đếm đầu tư qua customer_id (bao gồm cả week investment)
        const rows = await CustomerModel.aggregate([
            { $match: { isDeleted: false, referred_by: { $exists: true, $ne: null } } },
            { $group: {
                _id: '$referred_by',
                total: { $sum: 1 },
                kyc_done: { $sum: { $cond: [{ $in: ['$status', ['kyc_verified', 'active']] }, 1, 0] } },
                customerIds: { $push: '$_id' },
            }},
            { $sort: { total: -1 } },
            { $limit: 20 },
            { $lookup: { from: 'user_infos', localField: '_id', foreignField: '_id', pipeline: [{ $project: { full_name: 1 } }], as: 'info' } },
            { $lookup: {
                from: 'investments',
                let: { cids: '$customerIds' },
                pipeline: [
                    { $match: { $expr: { $in: ['$customer_id', '$$cids'] }, isDeleted: false } },
                    { $group: { _id: '$customer_id' } },
                    { $count: 'n' },
                ],
                as: 'inv',
            }},
            { $project: {
                sale_name: { $ifNull: [{ $arrayElemAt: ['$info.full_name', 0] }, 'Không rõ'] },
                total: 1,
                kyc_done: 1,
                invested: { $ifNull: [{ $arrayElemAt: ['$inv.n', 0] }, 0] },
            }},
        ]);

        res.json({ mode: 'manager', rows });
    } catch (err) {
        console.log('getConversion error:', err.message);
        res.status(500).json({ message: 'Lỗi lấy tỷ lệ chuyển đổi', error: err.message });
    }
};

module.exports = InvestmentController;