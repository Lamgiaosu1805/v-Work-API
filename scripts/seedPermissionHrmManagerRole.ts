import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

const ROLE_CODE = "HRM_MANAGER";

// Mirror "HR manager" (role=manager, module_access=["hrm"], dept_scope=all) trong CLAUDE.md.
// Toàn bộ 45 quyền HRM ở scope rộng nhất — TRỪ request.create/request.cancel (tự phục vụ cá nhân,
// đã có ở EMPLOYEE_BASELINE, không cần lặp lại). Xem docs/DEFAULT-PERMISSION-ROLES-PLAN.md mục 2.3.
const HRM_MANAGER_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "attendance.edit",
    dataScopePolicyCode: "ATTENDANCE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "attendance.import",
    dataScopePolicyCode: "ATTENDANCE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "attendance.view",
    dataScopePolicyCode: "ATTENDANCE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "attendance_mapping.delete",
    dataScopePolicyCode: "ATTENDANCE_MAPPING_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "attendance_mapping.manage",
    dataScopePolicyCode: "ATTENDANCE_MAPPING_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "attendance_mapping.view",
    dataScopePolicyCode: "ATTENDANCE_MAPPING_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "branch.delete",
    dataScopePolicyCode: "BRANCH_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "branch.manage",
    dataScopePolicyCode: "BRANCH_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "branch.view",
    dataScopePolicyCode: "BRANCH_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "department.delete",
    dataScopePolicyCode: "DEPARTMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "department.manage",
    dataScopePolicyCode: "DEPARTMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "department.view",
    dataScopePolicyCode: "DEPARTMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "document.view",
    dataScopePolicyCode: "DOCUMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "document_type.manage",
    dataScopePolicyCode: "DOCUMENT_TYPE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.create",
    dataScopePolicyCode: "EMPLOYEE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.set_status",
    dataScopePolicyCode: "EMPLOYEE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.update",
    dataScopePolicyCode: "EMPLOYEE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.view",
    dataScopePolicyCode: "EMPLOYEE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employment_status.delete",
    dataScopePolicyCode: "EMPLOYMENT_STATUS_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employment_status.manage",
    dataScopePolicyCode: "EMPLOYMENT_STATUS_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employment_status.view",
    dataScopePolicyCode: "EMPLOYMENT_STATUS_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "holiday.delete",
    dataScopePolicyCode: "HOLIDAY_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "holiday.manage",
    dataScopePolicyCode: "HOLIDAY_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "holiday.view",
    dataScopePolicyCode: "HOLIDAY_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file.delete",
    dataScopePolicyCode: "INTERNAL_FILE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file.manage",
    dataScopePolicyCode: "INTERNAL_FILE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file.view",
    dataScopePolicyCode: "INTERNAL_FILE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file_permission.manage",
    dataScopePolicyCode: "INTERNAL_FILE_PERMISSION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file_permission.view",
    dataScopePolicyCode: "INTERNAL_FILE_PERMISSION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "labor_contract.create",
    dataScopePolicyCode: "LABOR_CONTRACT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "payroll.view",
    dataScopePolicyCode: "PAYROLL_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "position.delete",
    dataScopePolicyCode: "POSITION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "position.manage",
    dataScopePolicyCode: "POSITION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "position.view",
    dataScopePolicyCode: "POSITION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "request.review",
    dataScopePolicyCode: "REQUEST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "request.view",
    dataScopePolicyCode: "REQUEST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shift_config.manage",
    dataScopePolicyCode: "SHIFT_CONFIG_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shift_config.view",
    dataScopePolicyCode: "SHIFT_CONFIG_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "weekly_report.submit",
    dataScopePolicyCode: "WEEKLY_REPORT_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "weekly_report.view",
    dataScopePolicyCode: "WEEKLY_REPORT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "wifi_config.delete",
    dataScopePolicyCode: "WIFI_CONFIG_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "wifi_config.manage",
    dataScopePolicyCode: "WIFI_CONFIG_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "wifi_config.view",
    dataScopePolicyCode: "WIFI_CONFIG_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "HR Manager",
    description:
      "Role hệ thống — toàn bộ quyền quản lý HRM ở phạm vi công ty (tạo/sửa/xoá/duyệt), trừ quyền tự phục vụ cá nhân (đã có ở EMPLOYEE_BASELINE).",
    isSystemRole: true,
    grants: HRM_MANAGER_GRANTS,
    isDeleted: false
  };

  if (!existing) {
    await PermissionRoleModel.create({ code: ROLE_CODE, ...payload });
    console.log(`✅ Tạo role: ${ROLE_CODE} (${HRM_MANAGER_GRANTS.length} permission)`);
    return;
  }

  const existingPlain = existing.toObject();
  const isSame =
    !existing.isDeleted &&
    existingPlain.name === payload.name &&
    existingPlain.description === payload.description &&
    existingPlain.isSystemRole === payload.isSystemRole &&
    isEqual(existingPlain.grants, payload.grants);

  if (isSame) {
    console.log(`⏭  Bỏ qua (đã đúng): role ${ROLE_CODE}`);
    return;
  }

  await PermissionRoleModel.updateOne({ _id: existing._id }, { $set: payload });
  console.log(`♻️  Cập nhật role: ${ROLE_CODE} (${HRM_MANAGER_GRANTS.length} permission)`);
}

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  await upsertRole();

  console.log(
    `\n🎉 Hoàn thành seed ${ROLE_CODE} — CHỈ tạo/cập nhật định nghĩa role, chưa gán cho nhân viên nào.`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
