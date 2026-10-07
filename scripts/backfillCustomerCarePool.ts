// Đưa khách MARKETING cũ (chưa có Sale, chưa đầu tư, không thuộc đại lý) đăng ký trong N ngày gần nhất
// vào kho chung của Quy định 183A. Khách đang có Sale KHÔNG bị tạo lượt giao hồi tố.
//
// Chạy thử:  npx ts-node scripts/backfillCustomerCarePool.ts --app=tikluy --days=30 --dry-run
// Chạy thật: npx ts-node scripts/backfillCustomerCarePool.ts --app=tikluy --days=30
// Yêu cầu: đã chạy seedCustomerCarePolicy.ts cho app. Idempotent (khách đã có trạng thái được bỏ qua).
import "dotenv/config";
import mongoose from "mongoose";
import AppModel from "../src/models/AppModel";
import CustomerModel from "../src/models/CustomerModel";
import InvestmentModel from "../src/models/InvestmentModel";
import CustomerCareStateModel from "../src/models/CustomerCareStateModel";
import CustomerCarePolicyModel from "../src/models/CustomerCarePolicyModel";
import { syncCustomerCareByCustomerId } from "../src/workflows/sync-customer-care.workflow";

const DAY_MS = 24 * 60 * 60 * 1000;

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : undefined;
}

async function main() {
  const appCode = argValue("app") ?? "tikluy";
  const days = Number(argValue("days"));
  const dryRun = process.argv.includes("--dry-run");
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("Thiếu hoặc sai --days=<số ngày> (vd --days=30)");
  }

  await mongoose.connect(process.env.MONGODB_URI as string);
  const app = (await AppModel.findOne({ code: appCode }).select("_id").lean()) as any;
  if (!app) throw new Error(`Không tìm thấy app "${appCode}"`);
  if (!(await CustomerCarePolicyModel.exists({ app_code: appCode, isDeleted: false }))) {
    throw new Error(
      `App "${appCode}" chưa có cấu hình — chạy scripts/seedCustomerCarePolicy.ts trước`
    );
  }

  const since = new Date(Date.now() - days * DAY_MS);
  const candidates = (await CustomerModel.find({
    app_id: app._id,
    isDeleted: false,
    referred_by: null,
    agent_id: null,
    registeredAt: { $gte: since }
  })
    .select("_id")
    .lean()) as any[];
  const ids = candidates.map((c) => c._id);

  const [invested, alreadyTracked] = await Promise.all([
    InvestmentModel.distinct("customer_id", {
      customer_id: { $in: ids },
      isDeleted: false,
      status: { $ne: "cancelled" }
    }),
    CustomerCareStateModel.distinct("customer_id", { customer_id: { $in: ids }, isDeleted: false })
  ]);
  const skip = new Set([...invested, ...alreadyTracked].map(String));
  const toBackfill = ids.filter((id) => !skip.has(String(id)));

  console.log(
    `App ${appCode}, ${days} ngày gần nhất: ${ids.length} khách marketing chưa có Sale; ` +
      `${invested.length} đã đầu tư, ${alreadyTracked.length} đã có trạng thái → đưa vào Pool: ${toBackfill.length}`
  );
  if (dryRun) {
    console.log("--dry-run: không ghi gì");
  } else {
    let done = 0;
    for (const id of toBackfill) {
      // eslint-disable-next-line no-await-in-loop
      await syncCustomerCareByCustomerId(String(id));
      done += 1;
      if (done % 100 === 0) console.log(`  ... ${done}/${toBackfill.length}`);
    }
    console.log(`Hoàn tất: ${done} khách đã vào kho chung`);
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
