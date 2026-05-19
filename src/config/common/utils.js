const AccountModel = require("../../models/AccountModel");

// Chuyển chuỗi tiếng Việt về ASCII (bỏ dấu + đổi đ→d)
function toAscii(str) {
    return str
        .toLowerCase()
        .replace(/đ/g, "d")   // đ → d (không decompose qua NFD)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")  // bỏ dấu combining
        .replace(/[^a-z0-9]/g, "");       // bỏ ký tự còn lại (khoảng trắng xử lý riêng)
}

const Utils = {
    getMaNV: (stt) => {
        if (stt.length == 1) return "00" + stt;
        if (stt.length == 2) return "0" + stt;
        return stt;
    },

    generateUsername: async (full_name) => {
        if (!full_name) throw new Error("full_name is required");

        const parts = full_name
            .trim()
            .toLowerCase()
            .replace(/đ/g, "d")
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .split(/\s+/)
            .filter(Boolean)
            .map(p => p.replace(/[^a-z0-9]/g, ""))
            .filter(Boolean);

        const lastName = parts.pop();          // Tên (cuối cùng): lam, doan...
        const initials = parts.map(p => p[0]).join(""); // Viết tắt họ + đệm: nk, td...
        let baseUsername = `${lastName}${initials}`;

        // Xử lý trùng username
        const existingUsers = await AccountModel.find({
            username: { $regex: `^${baseUsername}` }
        }).select("username");

        if (existingUsers.length > 0) {
            const sameBase = existingUsers
                .map(u => u.username)
                .filter(name => name.startsWith(baseUsername));

            let maxNum = 0;
            sameBase.forEach(name => {
                const num = parseInt(name.replace(baseUsername, "")) || 0;
                if (num > maxNum) maxNum = num;
            });

            baseUsername = `${baseUsername}${maxNum + 1}`;
        }

        return baseUsername;
    },

    genRandomPassword: () => {
        const lower   = "abcdefghijklmnopqrstuvwxyz";
        const upper   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const numbers = "0123456789";
        const special = "!@#";
        const all     = lower + upper + numbers + special;

        let password =
            lower[Math.floor(Math.random() * lower.length)] +
            upper[Math.floor(Math.random() * upper.length)] +
            numbers[Math.floor(Math.random() * numbers.length)] +
            special[Math.floor(Math.random() * special.length)];

        for (let i = 4; i < 8; i++) {
            password += all[Math.floor(Math.random() * all.length)];
        }

        return password.split("").sort(() => Math.random() - 0.5).join("");
    },
};

module.exports = Utils;
