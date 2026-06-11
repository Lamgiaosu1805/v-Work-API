require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const AttendancePenaltyTierModel = require("../src/models/AttendancePenaltyModel");

const TZ = "Asia/Ho_Chi_Minh";

const EFFECTIVE_FROM = process.argv[2] || "2026-01-01";

// Số lần quên chấm công (có đơn duyệt) reset vào mùng 1 hàng tháng dương lịch.
// Lần 1-3: không cần tier (mặc định đủ công).
const TIERS = [
  { type: "forgot", from_count: 4, to_count: 4,    penalty_kind: "money",     penalty_value: 50000,  description: "Quên chấm công lần 4 trong tháng, trừ 50k (vẫn đủ công)" },
  { type: "forgot", from_count: 5, to_count: 5,    penalty_kind: "money",     penalty_value: 100000, description: "Quên chấm công lần 5 trong tháng, trừ 100k (vẫn đủ công)" },
  { type: "forgot", from_count: 6, to_count: null, penalty_kind: "work_unit", penalty_value: 1,      description: "Quên chấm công lần 6 trở đi trong tháng, không tính công" },
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
    type: "forgot",
    effective_from: effMoment.toDate(),
    isDeleted: false,
  });
  if (existing) {
    console.log(`Đã tồn tại tier forgot với effective_from = ${effMoment.format("DD/MM/YYYY")}, bỏ qua.`);
    await mongoose.disconnect();
    return;
  }

  const docs = TIERS.map((t) => ({ ...t, effective_from: effMoment.toDate(), is_active: true }));
  const created = await AttendancePenaltyTierModel.insertMany(docs);
  console.log(`Đã seed ${created.length} tier forgot, hiệu lực từ ${effMoment.format("DD/MM/YYYY")}.`);

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
