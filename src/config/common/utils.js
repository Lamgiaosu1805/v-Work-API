const AccountModel = require("../../models/AccountModel");

const Utils = {
    getMaNV: (stt) => {
        if (stt.length == 1) {
            return "00" + stt
        }
        else if (stt.length == 2) {
            return "0" + stt
        }
        else if (stt.length >= 3) {
            return stt
        }
    },
    generateUsername: async (full_name) => {
        if (!full_name) throw new Error("full_name is required");

        // 1️⃣ Chuẩn hoá tên
        const parts = full_name
            .trim()
            .toLowerCase()
            .normalize("NFD") // loại bỏ dấu tiếng Việt
            .replace(/[\u0300-\u036f]/g, "")
            .split(" ")
            .filter(Boolean);

        const lastName = parts.pop(); // Tên (vd: Lâm)
        const initials = parts.map(p => p[0]).join(""); // NK (từ Nghiêm Khắc)
        let baseUsername = `${lastName}${initials}`;

        // 2️⃣ Kiểm tra trùng username
        const existingUsers = await AccountModel.find({ username: { $regex: `^${baseUsername}` } }).select("username");

        if (existingUsers.length > 0) {
            const sameBase = existingUsers
                .map(u => u.username)
                .filter(name => name.startsWith(baseUsername));

            // Tìm số lớn nhất đã tồn tại
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
        const lowerChars = "abcdefghijklmnopqrstuvwxyz";
        const upperChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const numbers = "0123456789";
        const specialChars = "!@#";

        // Chọn ngẫu nhiên 1 ký tự từ mỗi nhóm
        const randomLower = lowerChars[Math.floor(Math.random() * lowerChars.length)];
        const randomUpper = upperChars[Math.floor(Math.random() * upperChars.length)];
        const randomNumber = numbers[Math.floor(Math.random() * numbers.length)];
        const randomSpecial = specialChars[Math.floor(Math.random() * specialChars.length)];

        // Tạo tập hợp tất cả các ký tự
        const allChars = lowerChars + upperChars + numbers + specialChars;

        // Tạo các ký tự ngẫu nhiên khác cho đến khi đủ 8 ký tự
        let password = randomLower + randomUpper + randomNumber + randomSpecial;

        // Điền thêm các ký tự ngẫu nhiên từ tất cả các nhóm cho đến khi đủ 8 ký tự
        for (let i = 4; i < 8; i++) {
            password += allChars[Math.floor(Math.random() * allChars.length)];
        }

        // Xáo trộn mật khẩu để đảm bảo các ký tự đặc biệt, chữ hoa, chữ số không ở vị trí cố định
        password = password.split('').sort(() => Math.random() - 0.5).join('');

        return password;
    },
}

module.exports = Utils;