import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

const ROLE_CODE = "WORKPLACE_MANAGER_ALL";

// Mirror "Sale CRM manager"-style manager/["workplace"]/all trong CLAUDE.md, áp dụng cho Workplace.
// Toàn bộ 18 quyền Workplace ở scope rộng nhất — TRỪ post.view/post_comment.create (tự phục vụ,
// đã có ở EMPLOYEE_BASELINE). Không có bản "OWN_DEPARTMENT" — toàn bộ entity Workplace trong catalog
// hiện chỉ hỗ trợ ALL_COMPANY/SELF_ASSIGNED, không có Data Scope nào theo phòng ban — xem
// docs/DEFAULT-PERMISSION-ROLES-PLAN.md mục 2.5.
const WORKPLACE_MANAGER_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "kpi_metric.delete",
    dataScopePolicyCode: "KPI_METRIC_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "kpi_metric.manage",
    dataScopePolicyCode: "KPI_METRIC_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "kpi_metric.view",
    dataScopePolicyCode: "KPI_METRIC_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post.create",
    dataScopePolicyCode: "POST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post.delete",
    dataScopePolicyCode: "POST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post.edit",
    dataScopePolicyCode: "POST_SELF_ASSIGNED",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post.pin",
    dataScopePolicyCode: "POST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post_comment.delete",
    dataScopePolicyCode: "POST_COMMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "print_job.create",
    dataScopePolicyCode: "PRINT_JOB_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "print_job.view",
    dataScopePolicyCode: "PRINT_JOB_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shared_folder.delete",
    dataScopePolicyCode: "SHARED_FOLDER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shared_folder.manage",
    dataScopePolicyCode: "SHARED_FOLDER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shared_folder.view",
    dataScopePolicyCode: "SHARED_FOLDER_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shared_folder_audit_log.delete",
    dataScopePolicyCode: "SHARED_FOLDER_AUDIT_LOG_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shared_folder_audit_log.view",
    dataScopePolicyCode: "SHARED_FOLDER_AUDIT_LOG_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "shared_folder_permission.manage",
    dataScopePolicyCode: "SHARED_FOLDER_PERMISSION_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "Quản lý Workplace (toàn công ty)",
    description:
      "Role hệ thống — toàn bộ quyền quản lý Workplace ở phạm vi công ty (KPI, bảng tin, thư mục dùng chung, lịch sử in), trừ quyền tự phục vụ cá nhân (đã có ở EMPLOYEE_BASELINE).",
    isSystemRole: true,
    grants: WORKPLACE_MANAGER_GRANTS,
    isDeleted: false
  };

  if (!existing) {
    await PermissionRoleModel.create({ code: ROLE_CODE, ...payload });
    console.log(`✅ Tạo role: ${ROLE_CODE} (${WORKPLACE_MANAGER_GRANTS.length} permission)`);
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
  console.log(`♻️  Cập nhật role: ${ROLE_CODE} (${WORKPLACE_MANAGER_GRANTS.length} permission)`);
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
