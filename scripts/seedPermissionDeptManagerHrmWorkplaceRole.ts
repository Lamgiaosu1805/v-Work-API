import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

const ROLE_CODE = "DEPT_MANAGER_HRM_WORKPLACE";

// Mirror "IT head" (role=manager, module_access=["hrm","workplace"], dept_scope=own) trong CLAUDE.md.
// Quyền quản lý PHẠM VI PHÒNG BAN MÌNH — chỉ gồm entity thực sự có Data Scope OWN_DEPARTMENT (employee,
// internal_file, weekly_report), cộng .view read-only ALL_COMPANY cho dữ liệu tham chiếu chung (holiday,
// position, branch, shift_config, employment_status, document) để biết lịch/cấu hình công ty mà không có
// quyền sửa. KHÔNG gồm request.review — Request chỉ có REQUEST_SELF/REQUEST_ALL_COMPANY, không có
// REQUEST_OWN_DEPARTMENT, nên không thể cấp "duyệt đơn phòng ban mình" mà không over-grant thành duyệt
// toàn công ty — xem docs/DEFAULT-PERMISSION-ROLES-PLAN.md mục 2.4, câu hỏi còn mở.
// KHÔNG có quyền Workplace nào — toàn bộ entity Workplace hiện chỉ có Data Scope ALL_COMPANY/SELF_ASSIGNED,
// không có OWN_DEPARTMENT, nên chưa có cách cấp đúng nghĩa "quản lý Workplace phạm vi phòng ban".
const DEPT_MANAGER_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "employee.create",
    dataScopePolicyCode: "EMPLOYEE_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.set_status",
    dataScopePolicyCode: "EMPLOYEE_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.update",
    dataScopePolicyCode: "EMPLOYEE_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.view",
    dataScopePolicyCode: "EMPLOYEE_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file.delete",
    dataScopePolicyCode: "INTERNAL_FILE_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file.manage",
    dataScopePolicyCode: "INTERNAL_FILE_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "internal_file.view",
    dataScopePolicyCode: "INTERNAL_FILE_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "weekly_report.submit",
    dataScopePolicyCode: "WEEKLY_REPORT_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "weekly_report.view",
    dataScopePolicyCode: "WEEKLY_REPORT_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "holiday.view",
    dataScopePolicyCode: "HOLIDAY_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "position.view",
    dataScopePolicyCode: "POSITION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "branch.view",
    dataScopePolicyCode: "BRANCH_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shift_config.view",
    dataScopePolicyCode: "SHIFT_CONFIG_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employment_status.view",
    dataScopePolicyCode: "EMPLOYMENT_STATUS_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "document.view",
    dataScopePolicyCode: "DOCUMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "Quản lý phòng ban (HRM + Workplace, phạm vi phòng ban)",
    description:
      "Role hệ thống — quyền quản lý nhân sự/file nội bộ/báo cáo tuần trong PHẠM VI PHÒNG BAN MÌNH, cộng quyền xem read-only dữ liệu tham chiếu chung công ty. Chưa có quyền Workplace hay duyệt đơn phòng ban — thiếu hạ tầng Data Scope OWN_DEPARTMENT cho 2 nhóm này, xem docs/DEFAULT-PERMISSION-ROLES-PLAN.md mục 2.4.",
    isSystemRole: true,
    grants: DEPT_MANAGER_GRANTS,
    isDeleted: false
  };

  if (!existing) {
    await PermissionRoleModel.create({ code: ROLE_CODE, ...payload });
    console.log(`✅ Tạo role: ${ROLE_CODE} (${DEPT_MANAGER_GRANTS.length} permission)`);
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
  console.log(`♻️  Cập nhật role: ${ROLE_CODE} (${DEPT_MANAGER_GRANTS.length} permission)`);
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
