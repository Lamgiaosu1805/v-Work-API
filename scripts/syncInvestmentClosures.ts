import "dotenv/config";
import mongoose from "mongoose";
import { syncInvestmentClosures } from "../src/workflows/investment-closure-sync.workflow";

// Chạy bù (backfill) / chạy tay đồng bộ tất toán + tái tục từ danh mục đầu tư TIKLUY — cùng logic cron 01:30.
// Xem docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 3. Chạy thử trước: --dry-run (không ghi DB, vẫn gọi TIKLUY).
// Chạy: npx ts-node --transpile-only scripts/syncInvestmentClosures.ts --app=tikluy [--dry-run] [--limit=50] [--concurrency=3]

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
    concurrency: arg("concurrency") ? Number(arg("concurrency")) : undefined
  });

  console.log(`Khách cần hỏi TIKLUY: ${result.customers} — đã đồng bộ ${result.synced}`);
  console.log(
    `Khoản ghi nhận tất toán: ${result.closed} (tái tục ${result.renewed}, nối khoản tái tục ${result.renewalLinks})`
  );
  console.log(`Khoản đã tất toán bên TIKLUY nhưng vWork không có (mã lạ): ${result.unknownCodes}`);
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
