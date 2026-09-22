import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

const ROLE_CODE = "DEPT_LEAD";

const DEPT_MANAGER_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "request.review",
    dataScopePolicyCode: "REQUEST_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "request.view",
    dataScopePolicyCode: "REQUEST_OWN_DEPARTMENT",
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
    permissionCode: "weekly_report.view",
    dataScopePolicyCode: "WEEKLY_REPORT_OWN_DEPARTMENT",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "document.view",
    dataScopePolicyCode: "DOCUMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "kpi_metric.view",
    dataScopePolicyCode: "KPI_METRIC_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "Trưởng phòng",
    description:
      "Quản lý nhân sự/file nội bộ/báo cáo tuần trong phòng ban mình, xem read-only dữ liệu chung công ty.",
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
