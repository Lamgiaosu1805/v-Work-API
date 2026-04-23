// controllers/AppController.js
const AppModel = require("../models/AppModel");

const AppController = {
    // POST /apps
    create: async (req, res) => {
        try {
            const { name, code, description, logo_url } = req.body;

            if (!name || !code) {
                return res.status(400).json({ message: "Thiếu name hoặc code" });
            }

            // Chuẩn hóa code: lowercase, bỏ ký tự đặc biệt, chỉ giữ chữ/số/gạch dưới
            const normalizedCode = code.toLowerCase().replace(/[^a-z0-9_]/g, "");
            if (!normalizedCode) {
                return res.status(400).json({ message: "Code không hợp lệ" });
            }

            // Kiểm tra trùng code
            const existing = await AppModel.findOne({ code: normalizedCode });
            if (existing) {
                return res.status(409).json({ message: `Code "${normalizedCode}" đã tồn tại` });
            }

            const app = await AppModel.create({
                name,
                code: normalizedCode,
                description: description ?? null,
                logo_url: logo_url ?? null,
                is_active: true,
            });

            return res.status(201).json({
                message: "Tạo app thành công",
                app,
            });
        } catch (error) {
            console.error("Error in create app:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // GET /apps
    getAll: async (req, res) => {
        try {
            const apps = await AppModel.find({ isDeleted: false }).sort({ createdAt: -1 });
            return res.status(200).json({ apps });
        } catch (error) {
            console.error("Error in getAll apps:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    // PATCH /apps/:id/toggle
    toggle: async (req, res) => {
        try {
            const app = await AppModel.findById(req.params.id);
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại" });
            }

            app.is_active = !app.is_active;
            await app.save();

            return res.status(200).json({
                message: `App đã được ${app.is_active ? "kích hoạt" : "khóa"}`,
                app,
            });
        } catch (error) {
            console.error("Error in toggle app:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = AppController;