require("dotenv").config();
const mongoose = require("mongoose");
const EmploymentStatusModel = require("../src/models/EmploymentStatusModel");

const STATUSES = [
  {
    code: "probation",
    name: "Thử việc",
    accrues_annual_leave: false,
    can_use_annual_leave: false,
    retroactive_on_promote: false
  },
  {
    code: "official",
    name: "Chính thức",
    accrues_annual_leave: true,
    can_use_annual_leave: true,
    retroactive_on_promote: true
  }
];

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const seed = async () => {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const def of STATUSES) {
    const existing = await EmploymentStatusModel.findOne({ code: def.code });
    if (existing) {
      if (existing.isDeleted) {
        existing.isDeleted = false;
        await existing.save();
        console.log(`♻️  Khôi phục loại hợp đồng: ${def.code}`);
      } else {
        console.log(`⏭  Bỏ qua (đã có): ${def.code} — ${existing.name}`);
        skipped++;
      }
      continue;
    }
    await EmploymentStatusModel.create(def);
    console.log(`✅ Tạo loại hợp đồng: ${def.code} — ${def.name}`);
    created++;
  }

  console.log(`\n🎉 Hoàn thành: tạo mới ${created}, bỏ qua ${skipped} loại đã tồn tại`);
  process.exit(0);
};

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
