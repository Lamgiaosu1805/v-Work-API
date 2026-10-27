import "dotenv/config";
import mongoose from "mongoose";
import TicketSettingModel from "../src/models/TicketSettingModel";

// Đặt lại ngưỡng cảnh báo vàng của ticket (collection ticket_setting) theo bảng 4 mức khẩn mới
// (docs/TICKET-MODULE-PLAN.md mục 8.3). Giá trị mặc định trong code/schema chỉ áp khi tạo document mới nên
// document đã có vẫn giữ số cũ — script này ghi đè riêng unclaimed_minutes và silent_minutes, KHÔNG đụng
// các cài đặt khác (người phụ trách mặc định, tự đóng, lịch làm việc...).
// Idempotent — chạy lại nhiều lần cho cùng kết quả. Không tạo document mới: chưa có thì code tự dùng
// mặc định (cùng bảng này).
//
//   Xem trước, không ghi:  npx ts-node --transpile-only scripts/resetTicketAlertThresholds.ts --dry-run
//   Ghi thật:              npx ts-node --transpile-only scripts/resetTicketAlertThresholds.ts

// Phút LÀM VIỆC; 1 ngày làm việc = 540 phút (ca 08:00–17:00).
const DAY = 540;
const UNCLAIMED_MINUTES = { urgent: 6 * 60, high: 1 * DAY, normal: 2 * DAY, low: 5 * DAY };
const SILENT_MINUTES = { urgent: 1 * DAY, high: 2 * DAY, normal: 5 * DAY, low: 10 * DAY };

const dryRun = process.argv.includes("--dry-run");

async function run(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  const filter = { key: "default", isDeleted: false };
  const before = await TicketSettingModel.findOne(filter).lean();
  if (!before) {
    console.log(
      "⏭  Chưa có document cài đặt ticket — code sẽ tự dùng giá trị mặc định (đã là bảng mới)."
    );
    process.exit(0);
  }

  console.log(
    "Trước:",
    JSON.stringify({ unclaimed: before.unclaimed_minutes, silent: before.silent_minutes })
  );
  console.log("Sau:  ", JSON.stringify({ unclaimed: UNCLAIMED_MINUTES, silent: SILENT_MINUTES }));

  if (dryRun) {
    console.log("\n🔎 --dry-run: chưa ghi gì.");
    process.exit(0);
  }

  const result = await TicketSettingModel.updateOne(filter, {
    $set: { unclaimed_minutes: UNCLAIMED_MINUTES, silent_minutes: SILENT_MINUTES }
  });
  console.log(
    result.modifiedCount
      ? "♻️  Đã cập nhật ngưỡng cảnh báo."
      : "⏭  Ngưỡng đã đúng bảng mới, không cần đổi."
  );
  console.log(
    "ℹ️  Mốc cảnh báo của ticket đang mở được tính lại khi ticket có thao tác tiếp theo (đổi trạng thái, trao đổi, sửa)."
  );
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
