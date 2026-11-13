import "dotenv/config";
import mongoose from "mongoose";
import { syncInvestmentClosures } from "../src/workflows/investment-closure-sync.workflow";

// Chạy bù (backfill) / chạy tay đồng bộ tất toán + tái tục từ danh mục đầu tư TIKLUY — cùng logic cron 01:30.
// Xem docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 3. Chạy thử trước: --dry-run (không ghi DB, vẫn gọi TIKLUY).
// Chạy: npx ts-node --transpile-only scripts/syncInvestmentClosures.ts --app=tikluy [--dry-run] [--limit=50] [--concurrency=3]
//   --all-customers  hỏi TIKLUY cho MỌI khách (chạy bù khoản thiếu 1 lần; hằng đêm chỉ hỏi khách còn khoản chưa tất toán)
//   --no-backfill    không tạo bù khoản TIKLUY có mà vWork thiếu

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const dryRun = args.includes("--dry-run");
  console.log(`✅ Kết nối MongoDB thành công${dryRun ? " — CHẠY THỬ, không ghi" : ""}\n`);

  const result = await syncInvestmentClosures({
    appCode: arg("app") ?? "tikluy",
    dryRun,
    limitCustomers: arg("limit") ? Number(arg("limit")) : undefined,
    concurrency: arg("concurrency") ? Number(arg("concurrency")) : undefined,
    allCustomers: args.includes("--all-customers"),
    backfillMissing: !args.includes("--no-backfill")
  });

  console.log(`Khách cần hỏi TIKLUY: ${result.customers} — đã đồng bộ ${result.synced}`);
  console.log(
    `Khoản ghi nhận tất toán: ${result.closed} (tái tục ${result.renewed}, nối khoản tái tục ${result.renewalLinks})`
  );
  console.log(`Khoản đã tất toán bên TIKLUY nhưng vWork không có (mã lạ): ${result.unknownCodes}`);
  console.log(
    `Khoản TIKLUY có mà vWork thiếu → ${dryRun ? "sẽ tạo bù" : "đã tạo bù"}: ${result.backfilled} ` +
      `(sinh ra do tái tục ${result.backfillRenewals}, không tính tiền vào; không hoa hồng)`
  );
  console.log(
    `Không tạo bù: ${result.skippedNoTerm} dòng không kỳ hạn (VÍ VÀNG…) / thiếu dữ liệu, ` +
      `${result.skippedRecent} khoản mới bắt đầu < 3 ngày (chờ TIKLUY đẩy sang)`
  );
  if (result.backfillRows.length) {
    const day = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const label: Record<string, string> = {
      active: "đang đầu tư",
      matured: "đã đáo hạn",
      early_terminated: "tất toán trước hạn"
    };
    console.log(`\nDanh sách (tối đa ${result.backfillRows.length} dòng, tiền theo triệu đồng):`);
    [...result.backfillRows]
      .sort((a, b) => a.invested_at.getTime() - b.invested_at.getTime())
      .forEach((row) =>
        console.log(
          `  ${row.code ?? "—"}  ${row.product}  ${(row.amount / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}  ` +
            `${day(row.invested_at)} → ${day(row.maturity_at)}  ${label[row.status] ?? row.status}` +
            `${row.renewal ? "  [tái tục]" : ""}${row.counter ? "  [tại quầy]" : ""}`
        )
      );
  }
  if (result.errors.length) {
    console.log(`Lỗi ${result.errors.length} khách (tối đa 20):`);
    result.errors.slice(0, 20).forEach((e) => console.log(`  ${e.external_id}: ${e.message}`));
  }

  await mongoose.disconnect();
  console.log(`\n🎉 Xong${dryRun ? " (chạy thử)" : ""}`);
}

main().catch((err) => {
  console.error("❌ Lỗi:", err);
  process.exit(1);
});
