const crypto = require("crypto");
const redis = require("../config/redis");

function buildFingerprintKey(fp) {
    const str = `${fp.userAgent}|${fp.screen}|${fp.timezone}`;
    return crypto.createHash("md5").update(str).digest("hex");
}

const ReferralController = {
    track: async (req, res) => {
        try {
            const { ref } = req.body;

            if (!ref) {
                return res.status(400).json({ message: "Thiếu ref" });
            }

            const token = crypto.randomBytes(16).toString("hex");
            await redis.setex(`referral:${token}`, 600, ref); // 10 phút

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

            const ref = await redis.get(`referral:${token}`);

            if (ref) {
                await redis.del(`referral:${token}`); // dùng 1 lần rồi xóa
            }

            return res.status(200).json({ ref: ref ?? null });
        } catch (error) {
            console.error("Error in resolve:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = ReferralController;
