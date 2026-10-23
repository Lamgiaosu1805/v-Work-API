import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

// Role cho nhóm IT xử lý ticket hỗ trợ (docs/TICKET-MODULE-PLAN.md mục 6 & 10.3). Quyền tạo/xem/nhận ticket
// thường đã có ở role EMPLOYEE_BASELINE; 2 role này chỉ cấp thêm quyền xem ticket hạn chế / file nhạy cảm
// (CCCD, tờ trình) cho IT, và quyền quản lý + cấu hình cho trưởng IT. CHỈ tạo định nghĩa role — gán cho
// từng người ở màn Phân quyền.

const grant = (permissionCode: string): PermissionGrantDoc => ({
  permissionCode,
  dataScopePolicyCode: "TICKET_ALL_COMPANY",
  fieldScopePolicyCode: null
});

const IT_GRANTS = [grant("ticket.view_restricted"), grant("ticket.view_sensitive")];

const ROLES = [
  {
    code: "TICKET_IT",
    name: "IT xử lý ticket",
    description:
      "Xem ticket hạn chế (cần tờ trình) và file nhạy cảm (CCCD, chứng từ) của ticket hỗ trợ.",
    grants: IT_GRANTS
  },
  {
    code: "TICKET_IT_LEAD",
    name: "Trưởng IT (ticket)",
    description:
      "Như IT xử lý ticket, thêm: đổi chủ trì / đóng hộ ticket, giao ticket cho người trong phòng, cấu hình ticket.",
    grants: [
      ...IT_GRANTS,
      grant("ticket.manage"),
      grant("ticket.assign_member"),
      grant("ticket.config")
    ]
  }
];

async function upsertRole(role: (typeof ROLES)[number]): Promise<void> {
  const existing = await PermissionRoleModel.findOne({ code: role.code });
  const payload = {
    name: role.name,
    description: role.description,
    isSystemRole: true,
    grants: role.grants,
    isDeleted: false
  };

  if (!existing) {
    await PermissionRoleModel.create({ code: role.code, ...payload });
    console.log(`✅ Tạo role: ${role.code} (${role.grants.length} permission)`);
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
    console.log(`⏭  Bỏ qua (đã đúng): role ${role.code}`);
    return;
  }

  await PermissionRoleModel.updateOne({ _id: existing._id }, { $set: payload });
  console.log(`♻️  Cập nhật role: ${role.code} (${role.grants.length} permission)`);
}

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  for (const role of ROLES) {
    await upsertRole(role);
  }

  console.log(
    "\n🎉 Hoàn thành seed role ticket — CHỈ tạo/cập nhật định nghĩa role, chưa gán cho nhân viên nào."
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
