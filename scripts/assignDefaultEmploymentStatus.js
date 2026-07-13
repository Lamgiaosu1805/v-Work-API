require("dotenv").config();
const mongoose = require("mongoose");
const UserInfoModel = require("../src/models/UserInfoModel");
const EmploymentStatusModel = require("../src/models/EmploymentStatusModel");
const { adjustLeaveBalance } = require("../src/helpers/leaveBalance");
const { LEAVE_BALANCE_REASON } = require("../src/constants");
const { MONTHLY_ACCRUAL } = require("../src/config/common/leaveConfig");

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
