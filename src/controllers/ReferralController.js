const crypto = require("crypto");
const redis = require("../config/redis");

function buildFingerprintKey(fp) {
    const str = `${fp.userAgent}|${fp.screen}|${fp.timezone}`;
    return crypto.createHash("md5").update(str).digest("hex");
}

const ReferralController = {
    track: async (req, res) => {
        try {
            const { fingerprint, ref } = req.body;

            if (!fingerprint || !ref) {
                return res.status(400).json({ message: "Thiếu fingerprint hoặc ref" });
            }

            const key = buildFingerprintKey(fingerprint);
            await redis.setex(`referral:${key}`, 600, ref);

            return res.status(200).json({ ok: true });
        } catch (error) {
            console.error("Error in track:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },

    resolve: async (req, res) => {
        try {
            const { userAgent, screen, timezone } = req.query;

            if (!userAgent || !screen || !timezone) {
                return res.status(400).json({ message: "Thiếu thông tin fingerprint" });
            }

            const key = buildFingerprintKey({ userAgent, screen, timezone });
            const ref = await redis.get(`referral:${key}`);

            if (ref) {
                await redis.del(`referral:${key}`);
            }

            return res.status(200).json({ ref: ref ?? null });
        } catch (error) {
            console.error("Error in resolve:", error);
            return res.status(500).json({ message: "Internal server error", error: error.message });
        }
    },
};

module.exports = ReferralController;
