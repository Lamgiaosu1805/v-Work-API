// Bật phạm vi chăm sóc khách (Quy định 183A) cho 1 app ở CHẾ ĐỘ CHẠY THỬ: enabled = false → hệ thống
// chỉ ghi nhận khách vào kho chung, KHÔNG tự phân, KHÔNG cảnh báo/thu hồi. Bật thật bằng
// PUT /customer-care/policy/:appCode { "enabled": true } sau khi web/app đã có màn "Khách cần xử lý".
//
// Chạy: npx ts-node scripts/seedCustomerCarePolicy.ts --app=tikluy
// Idempotent: app đã có cấu hình thì giữ nguyên, không ghi đè.
import "dotenv/config";
import mongoose from "mongoose";
import CustomerCarePolicyModel from "../src/models/CustomerCarePolicyModel";
import { buildCarePolicy } from "../src/modules/customer-care/domain/care-policy";
import { policyToDoc } from "../src/modules/customer-care/infrastructure/care-context";

function argValue(name: string, fallback: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : fallback;
}

async function main() {
  const appCode = argValue("app", "tikluy");
  await mongoose.connect(process.env.MONGODB_URI as string);

  const existing = await CustomerCarePolicyModel.findOne({ app_code: appCode, isDeleted: false });
  if (existing) {
    console.log(
      `App "${appCode}" đã có cấu hình chăm sóc khách (enabled=${existing.enabled}) — bỏ qua`
    );
  } else {
    await CustomerCarePolicyModel.create({
      ...policyToDoc(buildCarePolicy(appCode, { enabled: false })),
      version: 1
    });
    console.log(
      `Đã tạo cấu hình chăm sóc khách cho "${appCode}" ở chế độ chạy thử (enabled=false)`
    );
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
