require("dotenv").config();
const mongoose = require("mongoose");
const AttendancePenaltyModel = require("../src/models/AttendancePenaltyModel");

const EFFECTIVE_FROM = new Date("2020-01-01T00:00:00+07:00");

const LATE_TIERS = [
  {
    from_minutes: 1,
    to_minutes: 15,
    penalty_kind: "money",
    penalty_value: 50000,
    description: "Đi muộn 8h01-8h15"
  },
  {
    from_minutes: 16,
    to_minutes: 30,
    penalty_kind: "money",
    penalty_value: 100000,
    description: "Đi muộn 8h16-8h30"
  },
  {
    from_minutes: 31,
    to_minutes: 60,
    penalty_kind: "money",
    penalty_value: 150000,
    description: "Đi muộn 8h31-9h00"
  },
  {
    from_minutes: 61,
    to_minutes: 240,
    penalty_kind: "half_day_money",
    penalty_value: 50000,
    description: "Đi muộn 9h01-12h00: nửa ngày công + trừ 50.000đ"
  }
];

const EARLY_TIERS = [
  {
    from_minutes: 1,
    to_minutes: 15,
    penalty_kind: "money",
    penalty_value: 50000,
    description: "Về sớm 16h45-16h59"
  },
  {
    from_minutes: 16,
    to_minutes: 30,
    penalty_kind: "money",
    penalty_value: 100000,
    description: "Về sớm 16h30-16h44"
  },
  {
    from_minutes: 31,
    to_minutes: 60,
    penalty_kind: "money",
    penalty_value: 150000,
    description: "Về sớm 16h00-16h29"
  },
  {
    from_minutes: 61,
    to_minutes: 300,
    penalty_kind: "half_day_money",
    penalty_value: 50000,
    description: "Về sớm 12h00-15h59: nửa ngày công + trừ 50.000đ"
  }
];

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const seedGeneration = async (type, tiers) => {
  const existing = await AttendancePenaltyModel.find({ type, isDeleted: false });
  if (existing.length > 0) {
    console.log(`⏭  Bỏ qua type="${type}" — đã có ${existing.length} tier:`);
    existing.forEach((t) =>
      console.log(
        `   from_minutes=${t.from_minutes} to_minutes=${t.to_minutes} penalty_kind=${t.penalty_kind} penalty_value=${t.penalty_value}`
      )
    );
    return;
  }

  const docs = tiers.map((t) => ({
    type,
    from_minutes: t.from_minutes,
    to_minutes: t.to_minutes,
    penalty_kind: t.penalty_kind,
    penalty_value: t.penalty_value,
    effective_from: EFFECTIVE_FROM,
    description: t.description,
    is_active: true
  }));

  const created = await AttendancePenaltyModel.insertMany(docs);
  console.log(`✅ Đã tạo ${created.length} tier type="${type}"`);
};

const seed = async () => {
  await connectDB();

  await seedGeneration("late", LATE_TIERS);
  await seedGeneration("early", EARLY_TIERS);

  console.log("\n🎉 Hoàn thành");
  process.exit(0);
};

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
