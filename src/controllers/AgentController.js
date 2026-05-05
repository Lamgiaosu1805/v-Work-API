const QRCode = require("qrcode");
const AgentModel = require("../models/AgentModel");
const AppModel = require("../models/AppModel");

const AgentController = {
    // POST /agents/upsert
    // Hệ thống đầu tư gọi sang khi tạo/cập nhật đại lý
    upsert: async (req, res) => {
        try {
            const {
                app_code,
                agent_code,
                external_id,
                agent_type,
                full_name,
                phone_number,
                email,
                address,
                branch_name,
            } = req.body;

            if (!app_code || !agent_code || !external_id || !full_name || !phone_number || !branch_name) {
                return res.status(400).json({
                    message: "Thiếu app_code, agent_code, external_id, full_name, phone_number hoặc branch_name",
                });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            const agent = await AgentModel.findOneAndUpdate(
                { app_id: app._id, agent_code },
                {
                    app_id: app._id,
                    agent_code,
                    external_id,
                    agent_type: agent_type || "INDIVIDUAL", // Gán giá trị agent_type, mặc định là INDIVIDUAL
                    full_name,
                    phone_number,
                    email: email ?? null,
                    address: address ?? null,
                    branch_name: branch_name,
                    is_active: true,
                },
                { upsert: true, new: true, runValidators: true } // Thêm runValidators: true để Mongoose check Enum
            );

            return res.status(200).json({
                message: "Đồng bộ đại lý thành công",
                agent,
            });
        } catch (error) {
            console.error("Error in agent upsert:", error);
            // Bắt lỗi Validation của Enum để trả về 400 thay vì 500
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: "Lỗi dữ liệu đầu vào", error: error.message });
            }
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /agents/:agent_code/qr?app_code=tikluy
    // Hệ thống đầu tư gọi sang để lấy QR hiển thị cho đại lý
    generateQR: async (req, res) => {
        try {
            const { agent_code } = req.params;
            const { app_code } = req.query;

            if (!app_code) {
                return res.status(400).json({ message: "Thiếu app_code" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            const agent = await AgentModel.findOne({
                app_id: app._id,
                agent_code,
                is_active: true,
            });
            if (!agent) {
                return res.status(404).json({ message: "Đại lý không tồn tại hoặc đã bị khóa" });
            }

            const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
            // type=agent để refer.html và app phân biệt với QR của sale
            const landingUrl = `${BASE_URL}/refer?ref=${agent_code}&type=agent`;

            const qrImageBase64 = await QRCode.toDataURL(landingUrl, {
                errorCorrectionLevel: "H",
                margin: 2,
                width: 400,
                color: { dark: "#000000", light: "#FFFFFF" },
            });

            return res.status(200).json({
                agent_name: agent.full_name,
                agent_code: agent.agent_code,
                landing_url: landingUrl,
                qr_image: qrImageBase64,
            });
        } catch (error) {
            console.error("Error in generateQR:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
    getAll: async (req, res) => {
        try {
            const {
                app_code,
                page = 1,
                limit = 20,
                search,
                is_active,
            } = req.query;

            if (!app_code) {
                return res.status(400).json({ message: "Thiếu app_code" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            const skip = (Number(page) - 1) * Number(limit);

            // Build filter
            const filter = { app_id: app._id };

            if (is_active !== undefined) {
                filter.is_active = is_active === "true";
            }

            if (search) {
                filter.$or = [
                    { full_name: { $regex: search, $options: "i" } },
                    { phone_number: { $regex: search, $options: "i" } },
                    { agent_code: { $regex: search, $options: "i" } },
                ];
            }

            const [agents, total] = await Promise.all([
                AgentModel.find(filter)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit)),
                AgentModel.countDocuments(filter),
            ]);

            return res.status(200).json({
                message: "Lấy danh sách đại lý thành công",
                data: agents,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error) {
            console.error("Error in getAll agents:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = AgentController;