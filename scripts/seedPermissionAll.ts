import { execFileSync } from "child_process";
import path from "path";

// Chạy toàn bộ seed permission ABAC theo đúng thứ tự dependency thật (không đoán):
// 1-3: nền tảng (catalog / data scope / field scope) — role nào cũng reference tới, phải có trước.
// 4: PERMISSION_ADMIN — tự throw lỗi rõ nếu catalog rỗng, nên phải sau bước 1.
// 5+: các role nghiệp vụ theo module — không throw cứng khi thiếu dependency, nhưng grant sẽ crash
//     lúc runtime (resolveEffectiveRules) nếu Data Scope Policy tham chiếu chưa tồn tại.
// Mỗi script trong danh sách đều IDEMPOTENT (upsert + so sánh isEqual trước khi ghi) — chạy lại
// nhiều lần, kể cả trên production đã có data, không tạo trùng/ghi đè sai.
const SEED_SCRIPTS = [
  "seedPermissionCatalog.ts",
  "seedPermissionDataScopePolicy.ts",
  "seedPermissionEntityAttributeCatalog.ts",
  "seedPermissionAdminRole.ts",
  "seedPermissionCrmRoles.ts",
  "seedPermissionEmployeeBaselineRole.ts",
  "seedPermissionHrmStaffRole.ts",
  "seedPermissionHrmManagerRole.ts",
  "seedPermissionDeptManagerHrmWorkplaceRole.ts",
  "seedPermissionWorkplaceManagerRole.ts"
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
