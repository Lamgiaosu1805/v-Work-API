import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import AccountModel from "../src/models/AccountModel";
import UserInfoModel from "../src/models/UserInfoModel";

const ROLE_CODE = "PERMISSION_ADMIN";

// Mặc định PERMISSION_ADMIN nhận scope RỘNG NHẤT (validDataScopePolicies[0]) của mọi permission —
// đúng nghĩa "toàn quyền". Ngoại lệ: màn "Gọi điện" (customer_call.view) là công cụ tác nghiệp của
// Sale, không phải công cụ quản trị — admin cũng chỉ nên thấy khách hàng do chính mình phụ trách,
// không phải toàn công ty. Quyết định theo yêu cầu người dùng (04-09-2026), chỉ áp cho đúng 1
// permission này — không áp cho customer_call.initiate/update_relationship_status hay call_log.*.
const ADMIN_SCOPE_OVERRIDES: Record<string, string> = {
  "customer_call.view": "CUSTOMER_SELF_ASSIGNED"
};

async function buildFullGrants(): Promise<PermissionGrantDoc[]> {
  const permissions = await PermissionCatalogModel.find({ isDeleted: false }).lean();
  if (!permissions.length) {
    throw new Error(
      "permission_catalog rỗng — chạy scripts/seedPermissionCatalog.ts trước khi seed role admin"
    );
  }

  return permissions.map((permission) => {
    const overrideScope = ADMIN_SCOPE_OVERRIDES[permission.code];
    const dataScope = overrideScope ?? permission.validDataScopePolicies[0];
    if (!dataScope) {
      throw new Error(`Permission "${permission.code}" không có validDataScopePolicies nào`);
    }
    return {
      permissionCode: permission.code,
      dataScopePolicyCode: dataScope,
      fieldScopePolicyCode: null
    };
  });
}

async function upsertRole(grants: PermissionGrantDoc[]): Promise<mongoose.Types.ObjectId> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "Quản trị hệ thống",
    description: "Toàn quyền hệ thống, gán sẵn cho admin để tránh bootstrap deadlock.",
    isSystemRole: true,
    grants,
    isDeleted: false
  };

  if (!existing) {
    const created = await PermissionRoleModel.create({ code: ROLE_CODE, ...payload });
    console.log(`✅ Tạo role: ${ROLE_CODE} (${grants.length} permission)`);
    return created._id as mongoose.Types.ObjectId;
  }

  const existingId = existing._id as mongoose.Types.ObjectId;
  const existingPlain = existing.toObject();
  const isSame =
    !existing.isDeleted &&
    existingPlain.name === payload.name &&
    existingPlain.description === payload.description &&
    existingPlain.isSystemRole === payload.isSystemRole &&
    isEqual(existingPlain.grants, payload.grants);

  if (isSame) {
    console.log(`⏭  Bỏ qua (đã đúng): role ${ROLE_CODE}`);
    return existingId;
  }

  await PermissionRoleModel.updateOne({ _id: existingId }, { $set: payload });
  console.log(`♻️  Cập nhật role: ${ROLE_CODE} (${grants.length} permission)`);
  return existingId;
}

async function assignRoleToAdmins(roleId: mongoose.Types.ObjectId): Promise<void> {
  const adminAccounts = await AccountModel.find({ role: "admin", isDeleted: false }).lean();
  if (!adminAccounts.length) {
    console.warn("⚠️  Không tìm thấy account nào có role=admin — bỏ qua bước gán role");
    return;
  }

  let assigned = 0;
  let skipped = 0;

  for (const account of adminAccounts) {
    const userInfo = await UserInfoModel.findOne({
      id_account: account._id,
      isDeleted: false
    }).lean();
    if (!userInfo) {
      console.warn(`⚠️  Account admin ${account._id} chưa có user_info — bỏ qua, gán tay sau`);
      continue;
    }

    const employeeId = userInfo._id;
    const existingProfile = await EmployeePermissionProfileModel.findOne({ employeeId });

    if (!existingProfile) {
      await EmployeePermissionProfileModel.create({
        employeeId,
        roleIds: [roleId],
        overrides: []
      });
      console.log(
        `✅ Tạo employee_permission_profile cho admin ${account.username} + gán ${ROLE_CODE}`
      );
      assigned++;
      continue;
    }

    const alreadyHasRole = existingProfile.roleIds.some((id) => id.equals(roleId));
    if (existingProfile.isDeleted || !alreadyHasRole) {
      await EmployeePermissionProfileModel.updateOne(
        { _id: existingProfile._id },
        {
          $set: { isDeleted: false },
          $addToSet: { roleIds: roleId }
        }
      );
      console.log(`♻️  Gán ${ROLE_CODE} vào profile có sẵn của admin ${account.username}`);
      assigned++;
      continue;
    }

    console.log(`⏭  Bỏ qua (đã có ${ROLE_CODE}): admin ${account.username}`);
    skipped++;
  }

  console.log(
    `\n👤 Admin: gán/cập nhật ${assigned}, bỏ qua ${skipped} (tổng ${adminAccounts.length})`
  );
}

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  const grants = await buildFullGrants();
  const roleId = await upsertRole(grants);
  await assignRoleToAdmins(roleId);

  console.log("\n🎉 Hoàn thành seed PERMISSION_ADMIN");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
