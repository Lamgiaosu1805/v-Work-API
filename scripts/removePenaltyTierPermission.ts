import "dotenv/config";
import mongoose from "mongoose";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import EntityAttributeCatalogModel from "../src/models/EntityAttributeCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";

// Gỡ nhóm quyền "Bậc phạt" (PenaltyTier) khỏi hệ thống ABAC — route /penaltyTier vẫn isAdmin-only,
// chưa từng thật sự dùng requirePermission, nên nhóm quyền này chỉ tồn tại thừa trong catalog
// (QA "Phân quyền" sheet, case "thừa nhóm quyền bậc phạt"). Idempotent — chạy lại nhiều lần an toàn.
const PENALTY_TIER_CODES = ["penalty_tier.view", "penalty_tier.manage", "penalty_tier.delete"];

async function pullFromRoleGrants(): Promise<void> {
  const result = await PermissionRoleModel.updateMany(
    { "grants.permissionCode": { $in: PENALTY_TIER_CODES } },
    { $pull: { grants: { permissionCode: { $in: PENALTY_TIER_CODES } } } }
  );
  console.log(`♻️  Gỡ grant penalty_tier khỏi ${result.modifiedCount} role`);
}

async function pullFromEmployeeOverrides(): Promise<void> {
  const result = await EmployeePermissionProfileModel.updateMany(
    { "overrides.permissionCode": { $in: PENALTY_TIER_CODES } },
    { $pull: { overrides: { permissionCode: { $in: PENALTY_TIER_CODES } } } }
  );
  console.log(`♻️  Gỡ override penalty_tier khỏi ${result.modifiedCount} employee_permission_profile`);
}

async function softDeleteCatalog(): Promise<void> {
  const result = await PermissionCatalogModel.updateMany(
    { code: { $in: PENALTY_TIER_CODES }, isDeleted: false },
    { $set: { isDeleted: true } }
  );
  console.log(`🗑  Soft-delete ${result.modifiedCount} permission_catalog (penalty_tier.*)`);
}

async function softDeleteEntityAttributeCatalog(): Promise<void> {
  const result = await EntityAttributeCatalogModel.updateMany(
    { entity: "PenaltyTier", isDeleted: false },
    { $set: { isDeleted: true } }
  );
  console.log(`🗑  Soft-delete ${result.modifiedCount} entity_attribute_catalog (PenaltyTier)`);
}

async function softDeleteDataScopePolicy(): Promise<void> {
  const result = await DataScopePolicyModel.updateMany(
    { code: "PENALTY_TIER_ALL_COMPANY", isDeleted: false },
    { $set: { isDeleted: true } }
  );
  console.log(`🗑  Soft-delete ${result.modifiedCount} data_scope_policy (PENALTY_TIER_ALL_COMPANY)`);
}

async function run(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công\n");

  // Gỡ tham chiếu ở role/override TRƯỚC khi soft-delete catalog — nếu làm ngược lại,
  // resolveEffectiveRules() sẽ throw ArgumentInvalidException cho role còn giữ grant trỏ tới
  // permissionCode đã bị xoá khỏi catalog.
  await pullFromRoleGrants();
  await pullFromEmployeeOverrides();
  await softDeleteCatalog();
  await softDeleteEntityAttributeCatalog();
  await softDeleteDataScopePolicy();

  console.log("\n🎉 Hoàn thành gỡ nhóm quyền Bậc phạt (PenaltyTier)");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
