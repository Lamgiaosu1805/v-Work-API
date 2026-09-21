import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

const ROLE_CODE = "COMPANY_EXECUTIVE";

const COMPANY_EXECUTIVE_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "dashboard_metric.view",
    dataScopePolicyCode: "DASHBOARD_METRIC_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "investment.view",
    dataScopePolicyCode: "INVESTMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "commission.view",
    dataScopePolicyCode: "COMMISSION_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.view",
    dataScopePolicyCode: "EMPLOYEE_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "payroll.view",
    dataScopePolicyCode: "PAYROLL_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "weekly_report.view",
    dataScopePolicyCode: "WEEKLY_REPORT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "document.view",
    dataScopePolicyCode: "DOCUMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "department.view",
    dataScopePolicyCode: "DEPARTMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "branch.view",
    dataScopePolicyCode: "BRANCH_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "position.view",
    dataScopePolicyCode: "POSITION_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "Ban Giám đốc / CEO (chỉ xem)",
    description:
      "Role hệ thống — quyền xem (view-only) dữ liệu tổng quan HRM + CRM ở phạm vi toàn công ty, không có quyền tạo/sửa/xoá.",
    isSystemRole: true,
    grants: COMPANY_EXECUTIVE_GRANTS,
    isDeleted: false
  };

  if (!existing) {
    await PermissionRoleModel.create({ code: ROLE_CODE, ...payload });
    console.log(`✅ Tạo role: ${ROLE_CODE} (${COMPANY_EXECUTIVE_GRANTS.length} permission)`);
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
  console.log(`♻️  Cập nhật role: ${ROLE_CODE} (${COMPANY_EXECUTIVE_GRANTS.length} permission)`);
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
