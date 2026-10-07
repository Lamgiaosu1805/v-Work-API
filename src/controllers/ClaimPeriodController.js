const ClaimPeriodModel = require("../models/ClaimPeriodModel");
const CustomerModel = require("../models/CustomerModel");
const CustomerInteractionModel = require("../models/CustomerInteractionModel");
const AppModel = require("../models/AppModel");
const UserInfoModel = require("../models/UserInfoModel");
const { getCarePolicyView } = require("../modules/customer-care");

// Quy định 183A: app đã bật phân khách tự động (vd TIKLUY) thì bỏ "đợt nhận khách" (ai nhanh người đó
// được) — khách chưa có Sale nằm trong kho chung và do hệ thống phân. App khác giữ quy trình cũ.
async function isAutoAllocationApp(appCode) {
    const policy = await getCarePolicyView(appCode);
    return policy.configured && policy.enabled;
}

const AUTO_ALLOCATION_MESSAGE =
    "Ứng dụng này đã chuyển sang phân khách tự động theo Quy định 183A, không dùng đợt nhận khách nữa";

// Helper: kiểm tra claim period có đang mở không
async function getActivePeriod(app_id) {
    const now = new Date();
    return await ClaimPeriodModel.findOne({
        app_id,
        is_active: true,
        start_at: { $lte: now },
        end_at: { $gte: now },
    });
}

const ClaimPeriodController = {

    // POST /claim-period — Admin tạo claim period
    create: async (req, res) => {
        try {
            const { app_code, start_at, end_at, note } = req.body;

            if (!app_code || !start_at || !end_at) {
                return res.status(400).json({ message: "Thiếu app_code, start_at hoặc end_at" });
            }

            if (new Date(start_at) >= new Date(end_at)) {
                return res.status(400).json({ message: "start_at phải nhỏ hơn end_at" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }
            if (await isAutoAllocationApp(app.code)) {
                return res.status(409).json({ message: AUTO_ALLOCATION_MESSAGE, is_open: false });
            }

            // Kiểm tra đã có period đang active chưa
            const existing = await getActivePeriod(app._id);
            if (existing) {
                return res.status(409).json({
                    message: "Đang có claim period đang mở, vui lòng đóng trước khi tạo mới",
                    period: existing,
                });
            }

            const period = await ClaimPeriodModel.create({
                app_id: app._id,
                start_at: new Date(start_at),
                end_at: new Date(end_at),
                note: note ?? null,
                created_by: req.account._id,
                is_active: true,
            });

            return res.status(201).json({
                message: "Tạo claim period thành công",
                period,
            });
        } catch (error) {
            console.error("Error in create claim period:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // PATCH /claim-period/:id/close — Admin đóng claim period
    close: async (req, res) => {
        try {
            const period = await ClaimPeriodModel.findById(req.params.id);
            if (!period) {
                return res.status(404).json({ message: "Không tìm thấy claim period" });
            }

            period.is_active = false;
            period.end_at = new Date(); // đóng ngay lập tức
            await period.save();

            return res.status(200).json({
                message: "Đóng claim period thành công",
                period,
            });
        } catch (error) {
            console.error("Error in close claim period:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /claim-period/status?app_code=tikluy — Check claim period hiện tại
    getStatus: async (req, res) => {
        try {
            const { app_code } = req.query;
            if (!app_code) {
                return res.status(400).json({ message: "Thiếu app_code" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }
            if (await isAutoAllocationApp(app.code)) {
                return res.status(200).json({
                    is_open: false,
                    period: null,
                    auto_allocation: true,
                    message: AUTO_ALLOCATION_MESSAGE,
                });
            }

            const period = await getActivePeriod(app._id);

            return res.status(200).json({
                is_open: !!period,
                period: period ?? null,
            });
        } catch (error) {
            console.error("Error in getStatus:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /claim-period/history?app_code=tikluy — Admin xem lịch sử
    getHistory: async (req, res) => {
        try {
            const { app_code, page = 1, limit = 20 } = req.query;
            if (!app_code) {
                return res.status(400).json({ message: "Thiếu app_code" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }
            const skip = (Number(page) - 1) * Number(limit);
            const [periods, total] = await Promise.all([
                ClaimPeriodModel.find({ app_id: app._id })
                    .populate("created_by", "username")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                ClaimPeriodModel.countDocuments({ app_id: app._id }),
            ]);

            return res.status(200).json({
                data: periods,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in getHistory:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /claim-period/unclaimed-customers — Sale xem KH chưa có người chăm sóc
    getUnclaimedCustomers: async (req, res) => {
        try {
            const { app_code, page = 1, limit = 20, search } = req.query;

            if (!app_code) {
                return res.status(400).json({ message: "Thiếu app_code" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }
            if (await isAutoAllocationApp(app.code)) {
                return res.status(409).json({ message: AUTO_ALLOCATION_MESSAGE, is_open: false });
            }

            // Kiểm tra claim period có đang mở không
            const period = await getActivePeriod(app._id);
            if (!period) {
                return res.status(403).json({
                    message: "Không trong thời gian nhận khách hàng",
                    is_open: false,
                });
            }

            const filter = {
                app_id: app._id,
                referred_by: null,
                agent_id: null,
                source_type: "marketing",
            };

            if (search) {
                filter.$or = [
                    { phone_number: { $regex: search, $options: "i" } },
                    { "identity.full_name": { $regex: search, $options: "i" } },
                ];
            }

            const skip = (Number(page) - 1) * Number(limit);
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
                message: "Lấy danh sách khách hàng chưa có người chăm sóc thành công",
                period: {
                    end_at: period.end_at,
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
            console.error("Error in getUnclaimedCustomers:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // POST /claim-period/claim — Sale nhận chăm sóc KH
    claimCustomer: async (req, res) => {
        try {
            const { app_code, customer_id } = req.body;
            const accountId = req.account._id;

            if (!app_code || !customer_id) {
                return res.status(400).json({ message: "Thiếu app_code hoặc customer_id" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }
            if (await isAutoAllocationApp(app.code)) {
                return res.status(409).json({ message: AUTO_ALLOCATION_MESSAGE, is_open: false });
            }

            // Kiểm tra claim period
            const period = await getActivePeriod(app._id);
            if (!period) {
                return res.status(403).json({
                    message: "Đã hết thời gian nhận khách hàng",
                    is_open: false,
                });
            }

            // Lấy thông tin sale
            const sale = await UserInfoModel.findOne({ id_account: accountId });
            if (!sale) {
                return res.status(404).json({ message: "Không tìm thấy thông tin nhân viên" });
            }

            // Tìm customer
            const customer = await CustomerModel.findOne({
                _id: customer_id,
                app_id: app._id,
            });
            if (!customer) {
                return res.status(404).json({ message: "Không tìm thấy khách hàng" });
            }

            // Kiểm tra đã có người chăm sóc chưa
            if (customer.referred_by || customer.agent_id) {
                return res.status(409).json({
                    message: "Khách hàng này đã có người chăm sóc rồi",
                });
            }

            // Gán sale cho customer — không CIF HH vì KH đã mở TK trước khi được nhận
            // HH eKYC sẽ tự ghi nhận nếu KH eKYC sau ngày referred_at
            await CustomerModel.findByIdAndUpdate(
                customer_id,
                {
                    $set: {
                        referred_by: sale._id,
                        source_type: "sale",
                        ref_code: `${sale.phone_number}-${sale.ma_nv}`,
                        referred_at: new Date(),
                    },
                }
            );

            // Ghi interaction log
            await CustomerInteractionModel.create({
                app_id: app._id,
                customer_id: customer._id,
                sale_id: sale._id,
                agent_id: null,
                type: "note",
                content: `Sale ${sale.full_name} nhận chăm sóc khách hàng trong claim period`,
                result: null,
            });

            return res.status(200).json({
                message: "Nhận chăm sóc khách hàng thành công",
                data: {
                    customer_id,
                    sale: {
                        ma_nv: sale.ma_nv,
                        full_name: sale.full_name,
                    },
                },
            });
        } catch (error) {
            console.error("Error in claimCustomer:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = ClaimPeriodController;