import "dotenv/config";
import mongoose from "mongoose";
import AccountModel from "../src/models/AccountModel";

interface AccountLean {
  _id: mongoose.Types.ObjectId;
  username: string;
  role: string;
  module_access: string[];
  dept_scope: string;
  isDeleted: boolean;
}

async function survey(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công\n");

  const accounts = (await AccountModel.find({}, "username role module_access dept_scope isDeleted")
    .lean()
    .exec()) as unknown as AccountLean[];

  const active = accounts.filter((a) => !a.isDeleted);
  const deleted = accounts.filter((a) => a.isDeleted);

  console.log(
    `Tổng account: ${accounts.length} (active: ${active.length}, deleted: ${deleted.length})\n`
  );

  const groups = new Map<string, { count: number; usernames: string[] }>();
  active.forEach((account) => {
    const moduleAccess = [...(account.module_access ?? [])].sort().join(",") || "(none)";
    const key = `role=${account.role} | module_access=[${moduleAccess}] | dept_scope=${account.dept_scope}`;
    const entry = groups.get(key) ?? { count: 0, usernames: [] };
    entry.count += 1;
    if (entry.usernames.length < 5) entry.usernames.push(account.username);
    groups.set(key, entry);
  });

  const sorted = Array.from(groups.entries()).sort((a, b) => b[1].count - a[1].count);

  console.log(
    `Tổ hợp role/module_access/dept_scope thật (${sorted.length} tổ hợp, chỉ tính account active):\n`
  );
  sorted.forEach(([key, entry]) => {
    const sample = entry.usernames.join(", ") + (entry.count > 5 ? ", ..." : "");
    console.log(`  [${entry.count}] ${key}`);
    console.log(`        vd: ${sample}`);
  });

  console.log("\n--- Breakdown riêng từng chiều (active) ---");
  const byRole = new Map<string, number>();
  const byDeptScope = new Map<string, number>();
  const byModule = new Map<string, number>();
  active.forEach((account) => {
    byRole.set(account.role, (byRole.get(account.role) ?? 0) + 1);
    byDeptScope.set(account.dept_scope, (byDeptScope.get(account.dept_scope) ?? 0) + 1);
    (account.module_access?.length ? account.module_access : ["(none)"]).forEach((module) => {
      byModule.set(module, (byModule.get(module) ?? 0) + 1);
    });
  });

  console.log("role:", Object.fromEntries(byRole));
  console.log("dept_scope:", Object.fromEntries(byDeptScope));
  console.log(
    "module_access (đếm theo từng module riêng, 1 account có thể thuộc nhiều module):",
    Object.fromEntries(byModule)
  );

  process.exit(0);
}

survey().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
