require("dotenv").config();
const mongoose = require("mongoose");

async function migrate() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("DB connected");

    const result = await mongoose.connection.collection("accounts").updateMany(
        {
            isDeleted: false,
            $or: [
                { module_access: null },
                { module_access: { $exists: false } },
                { module_access: { $all: ["hrm", "workplace"], $size: 2 } },
            ]
        },
        { $set: { module_access: [] } }
    );

    console.log(`Đã cập nhật ${result.modifiedCount} tài khoản`);
    await mongoose.disconnect();
}

migrate().catch((err) => {
    console.error("Lỗi migration:", err.message);
    process.exit(1);
});
