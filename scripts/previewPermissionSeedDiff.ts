import "dotenv/config";
import path from "path";
import { execFile } from "child_process";
import mongoose from "mongoose";
// mongodb-memory-server là devDependency: script chỉ chạy tay ở máy dev, không nằm trong bản build
// eslint-disable-next-line import/no-extraneous-dependencies
import { MongoMemoryReplSet } from "mongodb-memory-server";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";

// XEM TRƯỚC (chỉ đọc) việc chạy các seed quyền sẽ đổi gì trên DB đang trỏ tới bởi MONGODB_URI.
//
// Cách làm: dựng một MongoDB tạm trong bộ nhớ, chạy các seed lên đó để có "trạng thái đích", rồi so với DB thật
// (chỉ dùng find — KHÔNG ghi, KHÔNG xoá gì). Với mỗi role báo: quyền sẽ được THÊM, quyền sẽ bị BỎ, quyền đổi phạm vi
// dữ liệu, và số nhân viên đang giữ role đó (những người bị ảnh hưởng nếu có quyền bị bỏ).
//
// Chạy (trỏ DB live bằng file env nằm ngoài repo):
//   DOTENV_CONFIG_PATH="D:/secrets/live.env" npx ts-node --transpile-only scripts/previewPermissionSeedDiff.ts

// Đúng danh sách seed sẽ chạy trên live (cùng thứ tự). Không gồm seed CRM / HRM / Workplace vì ticket không đổi chúng.
const SEEDS = [
  "seedPermissionCatalog.ts",
  "seedPermissionDataScopePolicy.ts",
  "seedPermissionEntityAttributeCatalog.ts",
  "seedPermissionAdminRole.ts",
  "seedPermissionEmployeeBaselineRole.ts",
  "seedPermissionDeptLeadRole.ts",
  "seedPermissionCompanyExecutiveRole.ts",
  "seedPermissionTicketRoles.ts"
];

interface Grant {
  permissionCode: string;
  dataScopePolicyCode: string;
  fieldScopePolicyCode: string | null;
}

const runSeed = (file: string, uri: string) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      "node",
      ["-r", "ts-node/register/transpile-only", path.join(__dirname, file)],
      {
        cwd: path.join(__dirname, ".."),
        // MONGODB_URI đặt rõ ở đây nên dotenv không ghi đè: seed chạy lên DB TẠM, không bao giờ lên DB thật
        env: { ...process.env, MONGODB_URI: uri },
        timeout: 240000
      },
      (error, stdout, stderr) =>
        error ? reject(new Error(`${file}: ${stdout}\n${stderr}`)) : resolve()
    );
  });

const scopeOf = (grant: Grant) =>
  `${grant.dataScopePolicyCode}${grant.fieldScopePolicyCode ? ` / ${grant.fieldScopePolicyCode}` : ""}`;

async function readAll(db: mongoose.mongo.Db, collection: string): Promise<any[]> {
  return db
    .collection(collection)
    .find({ isDeleted: { $ne: true } })
    .toArray();
}

async function main(): Promise<void> {
  const liveUri = process.env.MONGODB_URI;
  if (!liveUri) throw new Error("Thiếu MONGODB_URI (DB cần so sánh)");

  console.log("⏳ Dựng DB tạm trong bộ nhớ và chạy các seed lên đó (không đụng DB thật)...");
  const memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  try {
    for (const seed of SEEDS) await runSeed(seed, memory.getUri());

    const target = (await mongoose.createConnection(memory.getUri()).asPromise())
      .db as mongoose.mongo.Db;
    const liveConn = await mongoose.createConnection(liveUri).asPromise();
    const live = liveConn.db as mongoose.mongo.Db;
    console.log(`🔎 So với DB thật: "${live.databaseName}" (chỉ đọc)\n`);

    // ---- danh mục quyền ----
    const catalogName = PermissionCatalogModel.collection.name;
    const liveCatalog = new Map((await readAll(live, catalogName)).map((x) => [x.code, x]));
    const targetCatalog = await readAll(target, catalogName);
    const newPerms = targetCatalog.filter((x) => !liveCatalog.has(x.code)).map((x) => x.code);
    const changedPerms = targetCatalog.filter((x) => {
      const old = liveCatalog.get(x.code);
      return (
        old &&
        JSON.stringify(old.validDataScopePolicies) !== JSON.stringify(x.validDataScopePolicies)
      );
    });
    console.log("=== DANH MỤC QUYỀN ===");
    console.log(`  Sẽ THÊM ${newPerms.length} quyền mới: ${newPerms.join(", ") || "(không)"}`);
    console.log(
      `  Sẽ CẬP NHẬT định nghĩa ${changedPerms.length} quyền có sẵn: ${changedPerms.map((x) => x.code).join(", ") || "(không)"}`
    );

    // ---- phạm vi dữ liệu ----
    const scopeName = DataScopePolicyModel.collection.name;
    const liveScopes = new Map((await readAll(live, scopeName)).map((x) => [x.code, x]));
    const targetScopes = await readAll(target, scopeName);
    const newScopes = targetScopes.filter((x) => !liveScopes.has(x.code)).map((x) => x.code);
    console.log("\n=== PHẠM VI DỮ LIỆU (data scope) ===");
    console.log(`  Sẽ THÊM: ${newScopes.join(", ") || "(không)"}`);

    // ---- role ----
    const roleName = PermissionRoleModel.collection.name;
    const profileName = EmployeePermissionProfileModel.collection.name;
    const liveRoles = new Map((await readAll(live, roleName)).map((x) => [x.code, x]));
    const targetRoles = await readAll(target, roleName);
    const profiles = await readAll(live, profileName);
    const holders = (roleId: unknown) =>
      profiles.filter((p) => (p.roleIds ?? []).some((id: any) => String(id) === String(roleId)))
        .length;

    console.log("\n=== ROLE ===");
    let destructive = 0;
    for (const role of targetRoles) {
      const old = liveRoles.get(role.code);
      if (!old) {
        console.log(
          `\n● ${role.code}: sẽ TẠO MỚI (${role.grants.length} quyền, chưa có nhân viên nào)`
        );
        continue;
      }
      const oldMap = new Map<string, Grant>(
        (old.grants ?? []).map((g: Grant) => [g.permissionCode, g])
      );
      const newMap = new Map<string, Grant>(role.grants.map((g: Grant) => [g.permissionCode, g]));
      const added = [...newMap.keys()].filter((code) => !oldMap.has(code));
      const removed = [...oldMap.keys()].filter((code) => !newMap.has(code));
      const rescoped = [...newMap.keys()].filter(
        (code) =>
          oldMap.has(code) &&
          scopeOf(oldMap.get(code) as Grant) !== scopeOf(newMap.get(code) as Grant)
      );
      if (!added.length && !removed.length && !rescoped.length) {
        console.log(`\n● ${role.code}: GIỮ NGUYÊN (đã đúng)`);
        continue;
      }
      const people = holders(old._id);
      console.log(`\n● ${role.code}  (${people} nhân viên đang giữ role này)`);
      console.log(`    + THÊM  (${added.length}): ${added.join(", ") || "—"}`);
      console.log(
        `    - BỎ    (${removed.length}): ${removed.join(", ") || "—"}${removed.length ? `   ⚠ ${people} người sẽ MẤT các quyền này` : ""}`
      );
      if (rescoped.length) {
        console.log(
          `    ~ ĐỔI PHẠM VI (${rescoped.length}): ${rescoped.map((code) => `${code}: ${scopeOf(oldMap.get(code) as Grant)} → ${scopeOf(newMap.get(code) as Grant)}`).join("; ")}`
        );
      }
      if (removed.length || rescoped.length) destructive += 1;
    }

    console.log(
      destructive
        ? `\n⚠ ${destructive} role sẽ MẤT hoặc ĐỔI quyền có sẵn — đọc kỹ các dòng "- BỎ" / "~ ĐỔI PHẠM VI" ở trên trước khi chạy seed.`
        : "\n✅ Chạy seed chỉ THÊM quyền / tạo role mới, không bỏ hay đổi quyền nào đang có."
    );
    console.log(
      "(Nhân viên nào đang giữ role nào KHÔNG đổi: các seed không gán / gỡ role của nhân viên, trừ việc gán role Quản trị cho tài khoản admin chưa có.)"
    );

    await liveConn.close();
  } finally {
    await memory.stop();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Lỗi:", error.message);
    process.exit(1);
  });
