require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const AttendancePenaltyTierModel = require("../src/models/AttendancePenaltyModel");

const TZ = "Asia/Ho_Chi_Minh";

const EFFECTIVE_FROM = process.argv[2] || "2026-01-01";

const TIERS = [
  { type: "late", from_minutes: 1,  to_minutes: 15,  penalty_kind: "money",     penalty_value: 50000,  description: "Đi muộn 1-15 phút" },
  { type: "late", from_minutes: 16, to_minutes: 30,  penalty_kind: "money",     penalty_value: 100000, description: "Đi muộn 16-30 phút" },
  { type: "late", from_minutes: 31, to_minutes: 60,  penalty_kind: "money",     penalty_value: 150000, description: "Đi muộn 31-60 phút" },
  { type: "late", from_minutes: 61, to_minutes: 240, penalty_kind: "work_unit", penalty_value: 0.5,    description: "Đi muộn 61-240 phút (tới 12h), trừ 0.5 công" },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("DB connected");

  const effMoment = moment.tz(EFFECTIVE_FROM, TZ).startOf("day");
  if (!effMoment.isValid()) {
    console.error("effective_from không hợp lệ:", EFFECTIVE_FROM);
    process.exit(1);
  }

  const existing = await AttendancePenaltyTierModel.findOne({
    type: "late",
    effective_from: effMoment.toDate(),
    isDeleted: false,
  });
  if (existing) {
    console.log(`Đã tồn tại tier với effective_from = ${effMoment.format("DD/MM/YYYY")}, bỏ qua.`);
    await mongoose.disconnect();
    return;
  }

  const docs = TIERS.map((t) => ({ ...t, effective_from: effMoment.toDate(), is_active: true }));
  const created = await AttendancePenaltyTierModel.insertMany(docs);
  console.log(`Đã seed ${created.length} tier, hiệu lực từ ${effMoment.format("DD/MM/YYYY")}.`);

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
