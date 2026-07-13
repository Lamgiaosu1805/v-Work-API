require("dotenv").config();
const mongoose = require("mongoose");
const AttendancePenaltyModel = require("../src/models/AttendancePenaltyModel");

const FORGOT_TIER = {
  type: "forgot",
  from_count: 4,
  to_count: null,
  penalty_kind: "work_unit",
  penalty_value: 1,
  effective_from: new Date("2020-01-01T00:00:00+07:00"),
  description: "Từ lần quên chấm công thứ 4 trong tháng: không được cộng công",
  is_active: true
};

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const seed = async () => {
  await connectDB();

  const existing = await AttendancePenaltyModel.find({ type: "forgot", isDeleted: false });
  if (existing.length > 0) {
    console.log(`⏭  Bỏ qua — đã có ${existing.length} tier "forgot":`);
    existing.forEach((t) =>
      console.log(
        `   from_count=${t.from_count} to_count=${t.to_count} penalty_value=${t.penalty_value} effective_from=${t.effective_from.toISOString()}`
      )
    );
    process.exit(0);
  }

  const doc = await AttendancePenaltyModel.create(FORGOT_TIER);
  console.log(
    `✅ Đã tạo tier "forgot": from_count=${doc.from_count}, penalty_value=${doc.penalty_value}, effective_from=${doc.effective_from.toISOString()}`
  );
  console.log("\n🎉 Hoàn thành");
  process.exit(0);
};

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
