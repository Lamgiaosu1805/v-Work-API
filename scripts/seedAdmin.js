require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const AccountModel = require("../src/models/AccountModel");

// Ưu tiên argument dòng lệnh, fallback về env var, rồi mới dùng default
// Cách dùng: node scripts/seedAdmin.js <username> <password>
const ADMIN_USERNAME = process.argv[2] || process.env.SEED_ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.argv[3] || process.env.SEED_ADMIN_PASSWORD || "Admin@123456";

async function seed() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("DB connected");

    const existing = await AccountModel.findOne({ username: ADMIN_USERNAME });
    if (existing) {
        console.log(`Tài khoản "${ADMIN_USERNAME}" đã tồn tại — bỏ qua.`);
        await mongoose.disconnect();
        return;
    }

    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await AccountModel.create({
        username: ADMIN_USERNAME,
        password: hashed,
        role: "admin",
        isFirstLogin: true,
    });

    console.log("-------------------------------------");
    console.log("Tạo tài khoản admin thành công");
    console.log(`Username : ${ADMIN_USERNAME}`);
    console.log(`Password : ${ADMIN_PASSWORD}`);
    console.log("Lần đăng nhập đầu sẽ yêu cầu đổi mật khẩu.");
    console.log("-------------------------------------");

    await mongoose.disconnect();
}

seed().catch((err) => {
    console.error("Lỗi seed admin:", err.message);
    process.exit(1);
});
