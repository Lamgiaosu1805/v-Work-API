require("dotenv").config();
const moment = require("moment-timezone");
const mongoose = require("mongoose");
const AttendancePenaltyModel = require("../src/models/AttendancePenaltyModel");

const TZ = "Asia/Ho_Chi_Minh";
const EFFECTIVE_FROM = moment.tz(TZ).startOf("day").toDate();

const FORGOT_TIERS_V2 = [
  {
    from_count: 4,
    to_count: 4,
    penalty_kind: "money",
    penalty_value: 50000,
    description: "Quên chấm công lần 4 trong tháng"
  },
  {
    from_count: 5,
    to_count: 5,
    penalty_kind: "money",
    penalty_value: 100000,
    description: "Quên chấm công lần 5 trong tháng"
  },
  {
    from_count: 6,
    to_count: null,
    penalty_kind: "work_unit",
    penalty_value: 0.5,
    description: "Quên chấm công từ lần 6 trong tháng: ghi nhận 0,5 công"
  }
];

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const seed = async () => {
  await connectDB();

  const existing = await AttendancePenaltyModel.find({
    type: "forgot",
    effective_from: EFFECTIVE_FROM,
    isDeleted: false
  });
  if (existing.length > 0) {
    console.log(`⏭  Bỏ qua — đã có ${existing.length} tier "forgot" ở generation hôm nay:`);
    existing.forEach((t) =>
      console.log(
        `   from_count=${t.from_count} to_count=${t.to_count} penalty_kind=${t.penalty_kind} penalty_value=${t.penalty_value}`
      )
    );
    process.exit(0);
  }

  const docs = FORGOT_TIERS_V2.map((t) => ({
    type: "forgot",
    from_count: t.from_count,
    to_count: t.to_count,
    penalty_kind: t.penalty_kind,
    penalty_value: t.penalty_value,
    effective_from: EFFECTIVE_FROM,
    description: t.description,
    is_active: true
  }));

  const created = await AttendancePenaltyModel.insertMany(docs);
  console.log(`✅ Đã tạo ${created.length} tier "forgot" (generation từ ${EFFECTIVE_FROM.toISOString()}):`);
  created.forEach((t) =>
    console.log(
      `   from_count=${t.from_count} to_count=${t.to_count} penalty_kind=${t.penalty_kind} penalty_value=${t.penalty_value}`
    )
  );
  console.log("\n🎉 Hoàn thành");
  process.exit(0);
};

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
