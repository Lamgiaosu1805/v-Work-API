import "dotenv/config";
import mongoose from "mongoose";
import moment from "moment-timezone";
import AppModel from "../src/models/AppModel";
import InvestmentModel from "../src/models/InvestmentModel";

// Sửa dữ liệu của LẦN ĐỒNG BỘ TẤT TOÁN ĐẦU TIÊN (chạy trước khi có cờ `closure.date_unknown`): khoản tất toán trước hạn
// mà hợp đồng chưa tới ngày đáo hạn bị ghi ngày tất toán = lúc phát hiện → dồn tiền ra vào đúng ngày chạy.
// Đánh dấu "không rõ ngày" để không tính tiền ra theo kỳ (vẫn trừ khỏi số dư). Xem docs/CRM-LEADERSHIP-DASHBOARD-AI-PLAN.md mục 8.
// Chỉ đụng khoản có closed_at = synced_at (ngày lấy theo lúc phát hiện) và đồng bộ trong ngày --synced-on.
// Chạy: npx ts-node --transpile-only scripts/markUnknownEarlyTerminations.ts --app=tikluy --synced-on=2026-11-13 [--dry-run]

const TZ = "Asia/Ho_Chi_Minh";
const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main(): Promise<void> {
  const syncedOn = arg("synced-on");
  if (!syncedOn || !moment(syncedOn, "YYYY-MM-DD", true).isValid()) {
    throw new Error("Thiếu --synced-on=YYYY-MM-DD (ngày chạy đồng bộ tất toán lần đầu)");
  }
  const dryRun = args.includes("--dry-run");
  await mongoose.connect(process.env.MONGODB_URI as string);
  const app = (await AppModel.findOne({ code: arg("app") ?? "tikluy" })
    .select("_id")
    .lean()) as any;
  if (!app) throw new Error("Không tìm thấy app");

  const from = moment.tz(syncedOn, TZ).startOf("day").toDate();
  const to = moment.tz(syncedOn, TZ).add(1, "day").startOf("day").toDate();
  const filter = {
    app_id: app._id,
    "closure.type": "early_terminated",
    "closure.date_unknown": { $ne: true },
    "closure.synced_at": { $gte: from, $lt: to },
    $expr: { $eq: ["$closure.closed_at", "$closure.synced_at"] }
  };
  const rows = (await InvestmentModel.find(filter).select("closure.principal").lean()) as any[];
  const total = rows.reduce((sum, r) => sum + (r.closure?.principal ?? 0), 0);
  console.log(
    `${dryRun ? "CHẠY THỬ — " : ""}Khoản tất toán trước hạn không rõ ngày: ${rows.length} | gốc ${Math.round(total / 1e6).toLocaleString("vi-VN")} triệu`
  );
  if (!dryRun && rows.length) {
    const res = await InvestmentModel.updateMany(filter, {
      $set: { "closure.date_unknown": true }
    });
    console.log(`Đã đánh dấu ${res.modifiedCount} khoản`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Lỗi:", err.message ?? err);
  process.exit(1);
});
