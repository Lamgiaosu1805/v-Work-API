const mongoose = require("mongoose");
const InvestmentModel = require("../models/InvestmentModel");
const CustomerModel = require("../models/CustomerModel");
const AppModel = require("../models/AppModel");
const UserInfoModel = require("../models/UserInfoModel");
const AgentModel = require("../models/AgentModel");
const { calculateCommission, getTNCNRate } = require("../helpers/commissionCalculator");

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
};

module.exports = InvestmentController;