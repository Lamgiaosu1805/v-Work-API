const crypto = require("crypto");
const redis = require("../config/redis");
const AgentModel = require("../models/AgentModel");
const UserInfoModel = require("../models/UserInfoModel");
const AppModel = require("../models/AppModel");

function buildFingerprintKey(fp) {
    const str = `${fp.userAgent}|${fp.screen}|${fp.timezone}`;
    return crypto.createHash("md5").update(str).digest("hex");
}

const ReferralController = {
    track: async (req, res) => {
        try {
            const { ref, type = "sale" } = req.body;  // thêm type

            if (!ref) {
                return res.status(400).json({ message: "Thiếu ref" });
            }

            const token = crypto.randomBytes(16).toString("hex");
            // Lưu cả ref lẫn type
            await redis.setex(`referral:${token}`, 300, JSON.stringify({ ref, type }));

            return res.status(200).json({ token });
        } catch (error) {
            console.error("Error in track:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    resolve: async (req, res) => {
        try {
            const { token } = req.query;

            if (!token) {
                return res.status(400).json({ message: "Thiếu token" });
            }

            const raw = await redis.get(`referral:${token}`);

            if (raw) {
                await redis.del(`referral:${token}`);
                const { ref, type } = JSON.parse(raw);
                return res.status(200).json({ ref, type });
            }

            return res.status(200).json({ ref: null, type: null });
        } catch (error) {
            console.error("Error in resolve:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
    // GET /referral/check?ref_code=xxx&app_code=tikluy
    checkReferral: async (req, res) => {
        try {
            const { ref_code, app_code } = req.query;

            if (!ref_code || !app_code) {
                return res.status(400).json({ message: "Thiếu ref_code hoặc app_code" });
            }

            const app = await AppModel.findOne({ code: app_code, is_active: true });
            if (!app) {
                return res.status(404).json({ message: "App không tồn tại hoặc đã bị khóa" });
            }

            let result = {
                ref_code,
                exists: false,
                type: null,
                info: null,
            };

            // Ưu tiên 1: Tìm sale nội bộ format "sđt-maNV"
            const parts = ref_code.split("-");
            if (parts.length === 2) {
                const [salePhone, saleMaNv] = parts;
                const sale = await UserInfoModel.findOne({
                    phone_number: salePhone,
                    ma_nv: saleMaNv,
                });
                if (sale) {
                    result = {
                        ref_code,
                        exists: true,
                        type: "sale",
                        info: {
                            ma_nv: sale.ma_nv,
                            full_name: sale.full_name,
                            phone_number: sale.phone_number,
                        },
                    };
                    return res.status(200).json(result);
                }
            }

            // Ưu tiên 2: Tìm agent_code
            const agent = await AgentModel.findOne({
                app_id: app._id,
                agent_code: ref_code,
                is_active: true,
            });
            if (agent) {
                result = {
                    ref_code,
                    exists: true,
                    type: "agent",
                    info: {
                        agent_code: agent.agent_code,
                        full_name: agent.full_name,
                        phone_number: agent.phone_number,
                    },
                };
                return res.status(200).json(result);
            }

            // Không tìm thấy
            return res.status(200).json({
                ref_code,
                exists: false,
                type: null,
                info: null,
            });

        } catch (error) {
            console.error("Error in checkReferral:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = ReferralController;
