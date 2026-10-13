// Kiểm tra 1 quyền đã "lên" cho nhân viên chưa: so sánh quyền đang CACHE trong Redis với quyền TÍNH LẠI
// từ DB (role + override). Chỉ ĐỌC — không ghi DB, không xoá cache.
//
//   npx ts-node --transpile-only scripts/checkPermissionCache.ts [permissionCode] [maNV]
//   vd: npx ts-node --transpile-only scripts/checkPermissionCache.ts employee.resign
//       npx ts-node --transpile-only scripts/checkPermissionCache.ts employee.resign NV001
//
// Khoá cache có tiền tố theo BASE_URL → chạy với đúng .env của service (test/live) cần kiểm tra.
import "dotenv/config";
import mongoose from "mongoose";
import redis from "../src/config/redis";
import UserInfoModel from "../src/models/UserInfoModel";
import { resolveEffectiveRules } from "../src/modules/permission";
import { buildPermissionCacheKey } from "../src/core/authorization/permission-cache-key";

type Rule = { action: string | string[]; inverted?: boolean };

const hasPermission = (rules: Rule[], code: string) =>
  rules.some((rule) => !rule.inverted && [].concat(rule.action as never).includes(code as never));

async function countCachedKeysByPrefix(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let cursor = "0";
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, keys] = await redis.scan(cursor, "MATCH", "*:perm:employee:*", "COUNT", 500);
    cursor = next;
    keys.forEach((key: string) => {
      const prefix = key.split(":perm:employee:")[0];
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    });
  } while (cursor !== "0");
  return counts;
}

async function main(): Promise<void> {
  const permissionCode = process.argv[2] || "employee.resign";
  const maNv = process.argv[3];

  await mongoose.connect(process.env.MONGODB_URI as string);
  const currentPrefix = buildPermissionCacheKey("").replace(/:perm:employee:$/, "");

  console.log(`🔎 Quyền cần kiểm tra: ${permissionCode}`);
  console.log(`🔑 Tiền tố cache theo .env hiện tại: "${currentPrefix}"`);
  const prefixes = await countCachedKeysByPrefix();
  console.log("📦 Số nhân viên đang có cache quyền trong Redis, theo từng môi trường (tiền tố):");
  if (!prefixes.size) console.log("   (chưa có cache nào)");
  prefixes.forEach((count, prefix) => {
    console.log(`   - "${prefix}": ${count}${prefix === currentPrefix ? "  ← đang kiểm tra" : ""}`);
  });

  const users = await UserInfoModel.find({ isDeleted: false, ...(maNv ? { ma_nv: maNv } : {}) })
    .select("ma_nv full_name")
    .sort({ ma_nv: 1 })
    .lean();
  if (!users.length) {
    console.log(maNv ? `❌ Không tìm thấy nhân viên mã ${maNv}` : "❌ Không có nhân viên nào");
    return;
  }

  const rows: { label: string; db: boolean; cache: string }[] = [];
  for (const user of users as any[]) {
    const employeeId = String(user._id);
    // eslint-disable-next-line no-await-in-loop
    const [cachedRaw, dbRules] = await Promise.all([
      redis.get(buildPermissionCacheKey(employeeId)),
      resolveEffectiveRules(employeeId)
    ]);
    const db = hasPermission(dbRules as Rule[], permissionCode);
    let cache = "chưa có cache";
    if (cachedRaw) cache = hasPermission(JSON.parse(cachedRaw), permissionCode) ? "có" : "KHÔNG";
    if (maNv || db || cache === "có") {
      rows.push({ label: `${user.ma_nv} · ${user.full_name}`, db, cache });
    }
  }

  const verdict = (row: { db: boolean; cache: string }) => {
    if (row.db && row.cache === "có") return "✅ Đã có quyền";
    if (row.db && row.cache === "chưa có cache")
      return "✅ Sẽ có quyền (cache tự tính lần gọi API tới)";
    if (row.db) return "⚠️  Cache cũ đang chặn — cần xoá cache";
    if (row.cache === "có") return "⚠️  Cache còn quyền đã bị gỡ — cần xoá cache";
    return "— Không có quyền";
  };

  console.log(
    `\n👤 ${maNv ? "Nhân viên" : "Nhân viên có quyền theo DB hoặc theo cache"}: ${rows.length}`
  );
  rows.forEach((row) => {
    console.log(
      `   ${verdict(row)}  |  DB: ${row.db ? "có" : "không"}  |  Redis: ${row.cache}  |  ${row.label}`
    );
  });

  const stale = rows.filter(
    (row) => row.db !== (row.cache === "có") && row.cache !== "chưa có cache"
  );
  console.log(
    stale.length
      ? `\n⚠️  ${stale.length} nhân viên lệch giữa DB và cache → chạy scripts/invalidateAllPermissionCache.ts (cùng .env).`
      : "\n✅ Không có nhân viên nào bị lệch giữa DB và cache."
  );
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
