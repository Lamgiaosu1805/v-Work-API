/**
 * Migration: Gán type="department" cho tất cả records cũ không có type
 *
 * Chạy MỘT LẦN trên server trước khi restart API sau khi deploy:
 *   node scripts/migrateSetDeptType.js
 *
 * An toàn: chỉ update records có type = null/undefined, không đụng records đã có type.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const DepartmentModel = require("../src/models/DepartmentModel");

const connectDB = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Kết nối MongoDB thành công");
};

const migrate = async () => {
    await connectDB();

    // Đếm trước
    const total = await DepartmentModel.countDocuments({ isDeleted: false });
    const withType = await DepartmentModel.countDocuments({ isDeleted: false, type: { $exists: true, $ne: null } });
    const needsMigration = total - withType;

    console.log(`📊 Tổng phòng ban: ${total}`);
    console.log(`✅ Đã có type: ${withType}`);
    console.log(`⚠️  Cần migrate: ${needsMigration}`);

    if (needsMigration === 0) {
        console.log("\n✨ Không có gì cần migrate.");
        process.exit(0);
    }

    // Set type="department" cho tất cả records không có type
    const result = await DepartmentModel.updateMany(
        { type: { $exists: false } },
        { $set: { type: "department" } }
    );

    // Cũng update records có type = null
    const result2 = await DepartmentModel.updateMany(
        { type: null },
        { $set: { type: "department" } }
    );

    const updated = result.modifiedCount + result2.modifiedCount;
    console.log(`\n🎉 Đã set type="department" cho ${updated} phòng ban cũ.`);
    console.log("💡 Sau đó vào web > Quản lý Phòng ban để chỉnh type cho từng node đúng với sơ đồ tổ chức.");
    process.exit(0);
};

migrate().catch((err) => {
    console.error("❌ Lỗi:", err.message);
    process.exit(1);
});
