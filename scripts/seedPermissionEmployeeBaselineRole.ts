import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

const ROLE_CODE = "EMPLOYEE_BASELINE";

const BASELINE_GRANTS: PermissionGrantDoc[] = [
  {
    permissionCode: "request.create",
    dataScopePolicyCode: "REQUEST_SELF",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "request.view",
    dataScopePolicyCode: "REQUEST_SELF",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "request.cancel",
    dataScopePolicyCode: "REQUEST_SELF",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "employee.view",
    dataScopePolicyCode: "EMPLOYEE_SELF",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "attendance.view",
    dataScopePolicyCode: "ATTENDANCE_SELF",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post.view",
    dataScopePolicyCode: "POST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post_comment.create",
    dataScopePolicyCode: "POST_COMMENT_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post.create",
    dataScopePolicyCode: "POST_ALL_COMPANY",
    fieldScopePolicyCode: null
  },
  {
    permissionCode: "post.edit",
    dataScopePolicyCode: "POST_SELF_ASSIGNED",
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
    permissionCode: "shared_folder.view",
    dataScopePolicyCode: "SHARED_FOLDER_ALL_COMPANY",
    fieldScopePolicyCode: null
  }
];

async function upsertRole(): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: ROLE_CODE });
  const payload = {
    name: "Nhân viên",
    description:
      "Quyền tự phục vụ tối thiểu cho mọi nhân viên: đơn từ, hồ sơ, bảng công, bảng tin của chính mình.",
    isSystemRole: true,
    grants: BASELINE_GRANTS,
    isDeleted: false
  };

  if (!existing) {
    await PermissionRoleModel.create({ code: ROLE_CODE, ...payload });
    console.log(`✅ Tạo role: ${ROLE_CODE} (${BASELINE_GRANTS.length} permission)`);
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
  console.log(`♻️  Cập nhật role: ${ROLE_CODE} (${BASELINE_GRANTS.length} permission)`);
}

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  await upsertRole();

  console.log(
    `\n🎉 Hoàn thành seed ${ROLE_CODE} — CHỈ tạo/cập nhật định nghĩa role, chưa gán cho nhân viên nào. ` +
      "Vào màn Phân quyền để gán tay cho từng người."
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
