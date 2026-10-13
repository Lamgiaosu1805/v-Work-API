// Xoá cache quyền (Redis) của mọi nhân viên để lần gọi API kế tiếp tự tính lại quyền từ DB.
//
// Chạy SAU khi seed quyền/role trực tiếp vào DB (seedPermissionCatalog, seedPermission*Role...):
// seed ghi thẳng model nên không bắn event xoá cache như khi sửa trên màn Phân quyền, mà cache quyền
// không có hạn → người đã có cache sẽ không thấy quyền mới cho tới khi cache bị xoá.
//
// Khoá cache có tiền tố theo BASE_URL → phải chạy với ĐÚNG env của service (test/live) cần xoá.
//   npx ts-node --transpile-only scripts/invalidateAllPermissionCache.ts
import "dotenv/config";
import mongoose from "mongoose";
import redis from "../src/config/redis";
import UserInfoModel from "../src/models/UserInfoModel";
import { invalidatePermissionCache } from "../src/core/authorization/invalidate-permission-cache";

const BATCH_SIZE = 200;

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  const employeeIds = (await UserInfoModel.find({}).distinct("_id")).map(String);
  for (let i = 0; i < employeeIds.length; i += BATCH_SIZE) {
    await invalidatePermissionCache(employeeIds.slice(i, i + BATCH_SIZE));
  }

  console.log(`🎉 Đã xoá cache quyền của ${employeeIds.length} nhân viên`);
}

main()
  .then(() => 0)
  .catch((err) => {
    console.error("❌ Lỗi:", err.message);
    return 1;
  })
  .then(async (exitCode) => {
    await mongoose.disconnect();
    redis.disconnect();
    process.exit(exitCode);
  });
