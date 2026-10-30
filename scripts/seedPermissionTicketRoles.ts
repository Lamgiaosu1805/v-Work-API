import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionRoleModel, { PermissionGrantDoc } from "../src/models/PermissionRoleModel";

// Role cho người xử lý ticket hỗ trợ (docs/TICKET-MODULE-PLAN.md mục 6 & 10.3). Ticket thuộc phân hệ
// Workplace nên mã role theo quy ước WORKPLACE_*. Quyền tạo/xem ticket có ở role EMPLOYEE_BASELINE; quyền
// NHẬN / XỬ LÝ (ticket.handle) chỉ có ở 3 role này (chốt 30/10/2026). Role nhân viên hỗ trợ còn có quyền xem
// ticket hạn chế / file nhạy cảm (CCCD, tờ trình) và giao ticket cho phòng ban (chuyển việc nghiệp vụ về
// đơn vị chủ trì); role quản lý thêm quyền quản lý + cấu hình. CHỈ tạo định nghĩa role — gán cho từng người
// ở màn Phân quyền. Người của đơn vị khác được giao ticket (vd Kế toán, QTRR, ĐVKD) chỉ cần role HANDLER (chỉ có
// quyền nhận / xử lý, không xem được file nhạy cảm của ticket khác); IT dùng role STAFF.

const grant = (permissionCode: string): PermissionGrantDoc => ({
  permissionCode,
  dataScopePolicyCode: "TICKET_ALL_COMPANY",
  fieldScopePolicyCode: null
});

const STAFF_GRANTS = [
  grant("ticket.handle"),
  grant("ticket.assign_department"),
  grant("ticket.view_restricted"),
  grant("ticket.view_sensitive")
];

const ROLES = [
  {
    code: "WORKPLACE_TICKET_HANDLER",
    name: "Người xử lý ticket (đơn vị khác)",
    description:
      "Cộng thêm trên role Nhân viên: nhận / xử lý ticket (xem được mọi ticket thường của công ty và hàng chờ nhận). Không xem ticket hạn chế, không mở file nhạy cảm, không giao phòng ban. Dùng cho người của đơn vị khác IT được giao việc (Kế toán, QTRR, ĐVKD).",
    grants: [grant("ticket.handle")]
  },
  {
    code: "WORKPLACE_TICKET_STAFF",
    name: "Nhân viên hỗ trợ ticket",
    description:
      "Cộng thêm trên role Nhân viên: nhận / xử lý ticket, giao ticket cho phòng ban, xem ticket hạn chế (cần tờ trình) và file nhạy cảm (CCCD, chứng từ, tờ trình).",
    grants: STAFF_GRANTS
  },
  {
    code: "WORKPLACE_TICKET_MANAGER",
    name: "Quản lý ticket hỗ trợ",
    description:
      "Gồm quyền Nhân viên hỗ trợ ticket, thêm: đổi chủ trì / đóng hộ / sửa phân loại mọi ticket, giao ticket trong phòng, cấu hình ticket.",
    grants: [
      ...STAFF_GRANTS,
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
