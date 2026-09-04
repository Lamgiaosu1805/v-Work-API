import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

const ROLE_CODE = "HRM_STAFF";

// Mirror "HR nhân viên" (role=user, module_access=["hrm"], dept_scope=all) trong CLAUDE.md.
// Chỉ quyền .view — không gồm quyền tạo/sửa/xoá cấu hình hệ thống (holiday/position/branch/
// wifi_config/shift_config/employment_status/attendance_mapping/document_type) — những cái đó
// thuộc tier HRM_MANAGER. Danh sách này là suy luận từ tên quyền, CHƯA xác nhận với BA — xem
// docs/DEFAULT-PERMISSION-ROLES-PLAN.md mục 2.2.
const HRM_STAFF_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "employee.view",
    dataScopePolicyCode: "EMPLOYEE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "department.view",
    dataScopePolicyCode: "DEPARTMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "position.view",
    dataScopePolicyCode: "POSITION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "holiday.view",
    dataScopePolicyCode: "HOLIDAY_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "attendance.view",
    dataScopePolicyCode: "ATTENDANCE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employment_status.view",
    dataScopePolicyCode: "EMPLOYMENT_STATUS_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "branch.view",
    dataScopePolicyCode: "BRANCH_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "document.view",
    dataScopePolicyCode: "DOCUMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "weekly_report.view",
    dataScopePolicyCode: "WEEKLY_REPORT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "request.view",
    dataScopePolicyCode: "REQUEST_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "HR nhân viên",
    description:
      "Role hệ thống — quyền xem (view-only) toàn bộ dữ liệu HRM ở phạm vi công ty, phục vụ nghiệp vụ HR hàng ngày. Không gồm quyền tạo/sửa/xoá.",
    isSystemRole: true,
    grants: HRM_STAFF_GRANTS,
    isDeleted: false
  };

  if (!existing) {
    await PermissionRoleModel.create({ code: ROLE_CODE, ...payload });
    console.log(`✅ Tạo role: ${ROLE_CODE} (${HRM_STAFF_GRANTS.length} permission)`);
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
  console.log(`♻️  Cập nhật role: ${ROLE_CODE} (${HRM_STAFF_GRANTS.length} permission)`);
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
