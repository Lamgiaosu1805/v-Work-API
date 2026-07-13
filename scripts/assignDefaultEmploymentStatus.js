require("dotenv").config();
const mongoose = require("mongoose");
const UserInfoModel = require("../src/models/UserInfoModel");
const EmploymentStatusModel = require("../src/models/EmploymentStatusModel");
const { adjustLeaveBalance } = require("../src/helpers/leaveBalance");
const { LEAVE_BALANCE_REASON } = require("../src/constants");
const { MONTHLY_ACCRUAL } = require("../src/config/common/leaveConfig");

// Migration 1 lần: gán loại hợp đồng "Chính thức" (code: "official") cho MỌI nhân
// viên hiện có CHƯA có employment_status (mặc định coi nhân viên cũ trong hệ thống
// đã qua thử việc), đồng thời cộng bù phép hồi tố theo đúng công thức đang dùng ở
// UserController.setEmploymentStatus (số tháng từ start_date × MONTHLY_ACCRUAL).
// Nhân viên nào ĐÃ có employment_status sẽ bị bỏ qua — an toàn khi chạy lại nhiều lần.
//
// ⚠️ Ghi số dư phép thật cho nhân viên thật — mặc định chạy DRY RUN (chỉ in ra,
// KHÔNG ghi DB). Xem log dry-run kỹ trước khi chạy thật.
//
// Dry run:  node scripts/assignDefaultEmploymentStatus.js
// Chạy thật: node scripts/assignDefaultEmploymentStatus.js --apply

const APPLY = process.argv.includes("--apply");

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const run = async () => {
  await connectDB();

  const officialStatus = await EmploymentStatusModel.findOne({
    code: "official",
    isDeleted: false
  });
  if (!officialStatus) {
    console.error(
      "❌ Chưa có loại hợp đồng 'official' — chạy scripts/seedEmploymentStatus.js trước."
    );
    process.exit(1);
  }

  const employees = await UserInfoModel.find({
    isDeleted: false,
    employment_status: null
  });

  console.log(`🔍 Tìm thấy ${employees.length} nhân viên chưa có loại hợp đồng.`);
  if (!APPLY) console.log("ℹ️  Đang chạy DRY RUN — thêm --apply để ghi thật vào DB.\n");

  const now = new Date();
  let updated = 0;

  for (const emp of employees) {
    let months = 0;
    if (emp.start_date) {
      const start = new Date(emp.start_date);
      months = Math.floor(
        (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
      );
    }
    const backpay = months > 0 ? months * MONTHLY_ACCRUAL : 0;

    console.log(
      `${APPLY ? "✅" : "🔸"} ${emp.full_name} (${emp.ma_nv}) → Chính thức${
        backpay > 0
          ? `, cộng bù ${backpay} ngày (${months} tháng từ ${emp.start_date?.toISOString().slice(0, 10)})`
          : ""
      }`
    );

    if (!APPLY) continue;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (backpay > 0) {
        // allowNegative: true — backpay luôn dương, khớp đúng logic gốc ở
        // UserController.setEmploymentStatus.
        await adjustLeaveBalance({
          userId: emp._id,
          amount: backpay,
          reason: LEAVE_BALANCE_REASON.RETROACTIVE_PROMOTION_BACKPAY,
          refType: "system",
          note: `Seed: cộng bù ${months} tháng do gán loại hợp đồng mặc định`,
          allowNegative: true,
          session
        });
      }
      emp.employment_status = officialStatus._id;
      await emp.save({ session });
      await session.commitTransaction();
      updated += 1;
    } catch (err) {
      await session.abortTransaction();
      console.error(`❌ Lỗi với ${emp.full_name}: ${err.message}`);
    } finally {
      session.endSession();
    }
  }

  console.log(
    `\n🎉 Hoàn thành: ${
      APPLY
        ? `đã cập nhật ${updated}/${employees.length}`
        : `sẽ cập nhật ${employees.length} nhân viên (dry run)`
    }`
  );
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
