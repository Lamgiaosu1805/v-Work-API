import { execFileSync } from "child_process";
import path from "path";

const SEED_SCRIPTS = [
  "seedPermissionCatalog.ts",
  "seedPermissionDataScopePolicy.ts",
  "seedPermissionEntityAttributeCatalog.ts",
  "seedPermissionAdminRole.ts",
  "seedPermissionCrmRoles.ts",
  "seedPermissionEmployeeBaselineRole.ts",
  "seedPermissionHrmStaffRole.ts",
  "seedPermissionHrmManagerRole.ts",
  "seedPermissionDeptLeadRole.ts",
  "seedPermissionWorkplaceManagerRole.ts",
  "seedPermissionCompanyExecutiveRole.ts"
];

function runScript(fileName: string): void {
  const fullPath = path.join(__dirname, fileName);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`▶️  ${fileName}`);
  console.log("=".repeat(70));

  execFileSync("npx", ["ts-node", "--transpile-only", fullPath], {
    stdio: "inherit",
    env: process.env
  });
}

async function main(): Promise<void> {
  console.log(`🚀 Chạy tổng hợp ${SEED_SCRIPTS.length} seed permission ABAC theo thứ tự...\n`);

  for (const fileName of SEED_SCRIPTS) {
    runScript(fileName);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("🎉 Hoàn thành toàn bộ seed permission. Các role mới tạo (nếu có) CHƯA được gán cho");
  console.log("   nhân viên nào — vào màn Phân quyền để gán tay theo từng người/nhóm.");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\n❌ Dừng lại do 1 script seed lỗi:", err.message);
  process.exit(1);
});
