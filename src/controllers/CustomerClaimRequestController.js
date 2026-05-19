const mongoose = require("mongoose");
const CustomerModel = require("../models/CustomerModel");
const CustomerClaimRequestModel = require("../models/CustomerClaimRequestModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const UserInfoModel = require("../models/UserInfoModel");
const AppModel = require("../models/AppModel");
const InvestmentModel = require("../models/InvestmentModel");
const { createCifCommission, createEkycCommission } = require("../helpers/commissionCalculator");

const CustomerClaimRequestController = {

    // POST /customer-claim-request — Sale gửi yêu cầu nhận khách bằng SĐT
    submit: async (req, res) => {
        try {
            const { app_code, phone_number, note } = req.body;
            const accountId = req.account._id;

            if (!app_code || !phone_number) {
                return res.status(400).json({ message: "Thiếu app_code hoặc phone_number" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }

            // Tìm sale theo account
            const sale = await UserInfoModel.findOne({ id_account: accountId });
            if (!sale) {
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            // Tìm khách theo SĐT
            const customer = await CustomerModel.findOne({
                app_id: app._id,
                phone_number,
                isDeleted: false,
            });
            if (!customer) {
                return res.status(404).json({ message: "Không tìm thấy khách hàng với SĐT này" });
            }

            // Khách đã có sale phụ trách
            if (customer.referred_by) {
                return res.status(409).json({
                    message: "Khách hàng này đã có sale phụ trách, không thể gửi yêu cầu",
                });
            }

            // Kiểm tra cửa sổ thời gian
            const now = new Date();
            if (!customer.claim_window_until || now > new Date(customer.claim_window_until)) {
                return res.status(403).json({
                    message: "Đã hết thời gian gửi yêu cầu nhận khách hàng này. Vui lòng liên hệ Admin để được hỗ trợ.",
                    claim_window_until: customer.claim_window_until,
                });
            }

            // Sale đã gửi yêu cầu cho khách này chưa
            const existing = await CustomerClaimRequestModel.findOne({
                customer_id: customer._id,
                sale_id: sale._id,
                status: "pending",
                isDeleted: false,
            });
            if (existing) {
                return res.status(409).json({
                    message: "Bạn đã gửi yêu cầu cho khách hàng này rồi, vui lòng chờ Admin xử lý",
                    request: existing,
                });
            }

            const request = await CustomerClaimRequestModel.create({
                customer_id: customer._id,
                sale_id: sale._id,
                phone_number,
                note: note?.trim() || null,
            });

            return res.status(201).json({
                message: "Gửi yêu cầu thành công. Admin sẽ xem xét và phản hồi sớm nhất có thể.",
                data: {
                    request_id: request._id,
                    customer_name: customer.identity?.full_name || "Chưa eKYC",
                    phone_number,
                    claim_window_until: customer.claim_window_until,
                },
            });
        } catch (error) {
            console.error("Error in submit claim request:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /customer-claim-request — Admin xem danh sách yêu cầu
    list: async (req, res) => {
        try {
            const { status = "pending", page = 1, limit = 20, search } = req.query;

            const filter = { isDeleted: false };
            if (status !== "all") filter.status = status;

            // Tìm theo SĐT
            if (search) {
                filter.phone_number = { $regex: search, $options: "i" };
            }

            const skip = (Number(page) - 1) * Number(limit);
            const [requests, total] = await Promise.all([
                CustomerClaimRequestModel.find(filter)
                    .populate("customer_id", "phone_number identity.full_name claim_window_until referred_by")
                    .populate("sale_id", "full_name ma_nv phone_number")
                    .populate("resolved_by", "username")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                CustomerClaimRequestModel.countDocuments(filter),
            ]);

            return res.status(200).json({
                data: requests,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in list claim requests:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /customer-claim-request/mine — Sale xem yêu cầu của mình
    listMine: async (req, res) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            const accountId = req.account._id;

            const sale = await UserInfoModel.findOne({ id_account: accountId });
            if (!sale) {
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            const filter = { sale_id: sale._id, isDeleted: false };
            const skip = (Number(page) - 1) * Number(limit);

            const [requests, total] = await Promise.all([
                CustomerClaimRequestModel.find(filter)
                    .populate("customer_id", "phone_number identity.full_name claim_window_until")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                CustomerClaimRequestModel.countDocuments(filter),
            ]);

            return res.status(200).json({
                data: requests,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in listMine:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // PATCH /customer-claim-request/:id/approve — Admin phê duyệt
    approve: async (req, res) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const { id } = req.params;
            const accountId = req.account._id;

            const claimReq = await CustomerClaimRequestModel.findOne({
                _id: id,
                status: "pending",
                isDeleted: false,
            }).session(session);
            if (!claimReq) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy yêu cầu hoặc yêu cầu đã được xử lý" });
            }

            const customer = await CustomerModel.findOne({
                _id: claimReq.customer_id,
                isDeleted: false,
            }).session(session);
            if (!customer) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy khách hàng" });
            }

            if (customer.referred_by) {
                // Tự động reject yêu cầu này vì khách đã có người
                await CustomerClaimRequestModel.findByIdAndUpdate(id, {
                    status: "rejected",
                    resolved_by: accountId,
                    resolved_at: new Date(),
                    reject_reason: "Khách hàng đã được gán cho sale khác trước đó",
                }, { session });
                await session.commitTransaction();
                session.endSession();
                return res.status(409).json({ message: "Khách hàng đã có sale phụ trách, yêu cầu đã tự động bị từ chối" });
            }

            const sale = await UserInfoModel.findById(claimReq.sale_id).session(session);
            if (!sale) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            const isEkycDone = !!customer.identity?.verified_at;

            // Gán sale cho khách — source_type = "sale" vì admin xác nhận sale đã giới thiệu
            const updateData = {
                referred_by: sale._id,
                source_type: "sale",
                ref_code: `${sale.phone_number}-${sale.ma_nv}`,
                referred_at: new Date(),
            };

            // Auto-grant HH theo trạng thái KH tại thời điểm duyệt
            const cifGranted = !customer.cif_commission?.sale_id;
            const ekycGranted = isEkycDone && !customer.ekyc_commission?.sale_id;

            if (cifGranted) {
                updateData.cif_commission = createCifCommission(sale._id, accountId);
            }
            if (ekycGranted) {
                updateData.ekyc_commission = createEkycCommission(sale._id, accountId);
            }

            await CustomerModel.findByIdAndUpdate(
                customer._id,
                { $set: updateData },
                { session }
            );

            // Gán sale vào các gói đầu tư chưa có sale (KH đã đầu tư trước khi được nhận)
            await InvestmentModel.updateMany(
                {
                    customer_id: customer._id,
                    "commission.sale_id": null,
                    status: { $ne: "cancelled" },
                    isDeleted: false,
                },
                { $set: { "commission.sale_id": sale._id } },
                { session }
            );

            // Duyệt yêu cầu này
            await CustomerClaimRequestModel.findByIdAndUpdate(id, {
                status: "approved",
                resolved_by: accountId,
                resolved_at: new Date(),
            }, { session });

            // Tự động reject tất cả yêu cầu pending khác của cùng khách
            await CustomerClaimRequestModel.updateMany(
                { customer_id: customer._id, status: "pending", _id: { $ne: id } },
                {
                    status: "rejected",
                    resolved_by: accountId,
                    resolved_at: new Date(),
                    reject_reason: "Khách hàng đã được xác nhận cho sale khác",
                },
                { session }
            );

            await CustomerInteractionModel.create([{
                app_id: customer.app_id,
                customer_id: customer._id,
                sale_id: sale._id,
                agent_id: null,
                type: "note",
                content: `Admin xác nhận yêu cầu của sale ${sale.full_name} (${sale.ma_nv}) — KH do sale giới thiệu`,
                result: null,
                metadata: {
                    claim_request_id: claimReq._id,
                    approved_by: accountId,
                    cif_hh_granted: cifGranted,
                    ekyc_hh_granted: ekycGranted,
                },
            }], { session });

            await session.commitTransaction();
            session.endSession();

            return res.status(200).json({
                message: "Phê duyệt yêu cầu thành công",
                data: {
                    customer_id: customer._id,
                    phone_number: customer.phone_number,
                    sale: { _id: sale._id, full_name: sale.full_name, ma_nv: sale.ma_nv },
                },
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error("Error in approve claim request:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // PATCH /customer-claim-request/:id/reject — Admin từ chối
    reject: async (req, res) => {
        try {
            const { id } = req.params;
            const { reject_reason } = req.body;
            const accountId = req.account._id;

            if (!reject_reason?.trim()) {
                return res.status(400).json({ message: "Vui lòng nhập lý do từ chối" });
            }

            const claimReq = await CustomerClaimRequestModel.findOne({
                _id: id,
                status: "pending",
                isDeleted: false,
            });
            if (!claimReq) {
                return res.status(404).json({ message: "Không tìm thấy yêu cầu hoặc yêu cầu đã được xử lý" });
            }

            await CustomerClaimRequestModel.findByIdAndUpdate(id, {
                status: "rejected",
                resolved_by: accountId,
                resolved_at: new Date(),
                reject_reason: reject_reason.trim(),
            });

            return res.status(200).json({ message: "Đã từ chối yêu cầu" });
        } catch (error) {
            console.error("Error in reject claim request:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = CustomerClaimRequestController;
