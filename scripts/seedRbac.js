require("dotenv").config();
const mongoose = require("mongoose");
const PermissionModel = require("../src/models/PermissionModel");
const RoleModel = require("../src/models/RoleModel");
const RolePermissionModel = require("../src/models/RolePermissionModel");
const { PERMISSION } = require("../src/constants");

const PERMISSIONS = [
  { code: PERMISSION.KPI_DASHBOARD_VIEW, description: "Xem dashboard KPI" },
  { code: PERMISSION.KPI_METRIC_MANAGE, description: "Quản lý chỉ tiêu KPI" },
  { code: PERMISSION.KPI_YEAR_PLAN_ASSIGN, description: "Gán kế hoạch KPI năm" },
  { code: PERMISSION.KPI_YEAR_PLAN_ALLOCATE, description: "Phân bổ KPI theo quý/tháng" },
  { code: PERMISSION.KPI_ASSIGNMENT_MANAGE, description: "Quản lý phân công KPI" },
  { code: PERMISSION.KPI_TIER_CONFIG, description: "Cấu hình bậc KPI" },
  { code: PERMISSION.KPI_REPORT_SUBMIT, description: "Nộp báo cáo KPI" },
  { code: PERMISSION.KPI_MONTHEND_CLOSE, description: "Chốt KPI cuối tháng" },
  { code: PERMISSION.HRM_REQUEST_VIEW_ALL, description: "Xem tất cả đơn từ nhân viên" },
  {
    code: PERMISSION.HRM_REQUEST_REVIEW_ALL,
    description: "Duyệt mọi đơn (bỏ qua chuỗi phê duyệt)"
  },
  { code: PERMISSION.HRM_REQUEST_REVIEW, description: "Duyệt đơn trong phạm vi quản lý" },
  { code: PERMISSION.HRM_ATTENDANCE_IMPORT, description: "Nhập dữ liệu chấm công" },
  { code: PERMISSION.HRM_ATTENDANCE_EDIT, description: "Sửa dữ liệu chấm công" },
  {
    code: PERMISSION.HRM_MENU_ATTENDANCE_SETTINGS,
    description: "Xem menu Quản lý chấm công (ca làm, WiFi)"
  },
  { code: PERMISSION.HRM_MENU_ATTENDANCE_OVERVIEW, description: "Xem menu Tình trạng chấm công" },
  { code: PERMISSION.HRM_MENU_DEPARTMENT, description: "Xem menu Khối / Phòng ban" },
  { code: PERMISSION.HRM_MENU_BRANCH, description: "Xem menu Chi nhánh" },
  { code: PERMISSION.HRM_MENU_PAYROLL, description: "Xem menu Bảng lương" },
  { code: PERMISSION.HRM_MENU_WORK_UNIT, description: "Xem menu Công & Chấm công" },
  { code: PERMISSION.HRM_MENU_REPORTS, description: "Xem menu Báo cáo" },
  { code: PERMISSION.HRM_MENU_EVENTS, description: "Xem menu Sự kiện & Lịch" },
  { code: PERMISSION.HRM_MENU_SETTINGS, description: "Xem menu Cài đặt" },
  { code: PERMISSION.HRM_MENU_DOCUMENTS, description: "Xem menu Hồ sơ đính kèm" },
  { code: PERMISSION.HRM_MENU_POSITIONS, description: "Xem menu Vị trí / Chức vụ" },
  { code: PERMISSION.HRM_MENU_LOGS, description: "Xem menu Logs" },
  { code: PERMISSION.HRM_MENU_HELP, description: "Xem menu Trợ giúp & Tài liệu" },
  {
    code: PERMISSION.HRM_MENU_ATTENDANCE_MAPPING,
    description: "Xem menu Mapping máy chấm công"
  },
  { code: PERMISSION.HRM_MENU_PERMISSIONS, description: "Xem menu Phân quyền" },
  { code: PERMISSION.HRM_MENU_PERMISSIONS_RBAC, description: "Xem menu Phân quyền chi tiết" }
];

const DEPRECATED_PERMISSION_CODES = ["hrm.menu.view_data", "hrm.menu.admin", "hrm.menu.system"];

const ROLES = [
  {
    code: "hr",
    name: "Nhân sự",
    description: "Xem toàn bộ đơn từ của nhân viên; import/chỉnh sửa chấm công",
    permissions: [
      PERMISSION.HRM_REQUEST_VIEW_ALL,
      PERMISSION.HRM_ATTENDANCE_IMPORT,
      PERMISSION.HRM_ATTENDANCE_EDIT,
      PERMISSION.HRM_MENU_ATTENDANCE_SETTINGS
    ]
  },
  {
    code: "unit_head",
    name: "Trưởng đơn vị",
    description:
      "Duyệt đơn của nhân viên trong phạm vi phòng ban mình quản lý (xem docs/REQUEST-APPROVAL-CHAIN-PLAN.md)",
    permissions: [PERMISSION.HRM_REQUEST_REVIEW]
  }
];

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Kết nối MongoDB thành công");
};

const seed = async () => {
  await connectDB();

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const { code, description } of PERMISSIONS) {
    const existing = await PermissionModel.findOne({ code });
    if (existing) {
      const needsRestore = existing.isDeleted;
      const needsDescUpdate = existing.description !== description;
      if (needsRestore || needsDescUpdate) {
        existing.isDeleted = false;
        existing.description = description;
        await existing.save();
        console.log(`♻️  ${needsRestore ? "Khôi phục" : "Cập nhật mô tả"} permission: ${code}`);
        updated++;
      } else {
        console.log(`⏭  Bỏ qua (đã có): ${code}`);
        skipped++;
      }
      continue;
    }
    await PermissionModel.create({ code, group: code.split(".")[0], description });
    console.log(`✅ Tạo permission: ${code} — ${description}`);
    created++;
  }

  for (const code of DEPRECATED_PERMISSION_CODES) {
    const result = await PermissionModel.updateOne(
      { code, isDeleted: false },
      { $set: { isDeleted: true } }
    );
    if (result.modifiedCount > 0) console.log(`🗑️  Đã xoá mềm permission cũ: ${code}`);
  }

  for (const roleDef of ROLES) {
    let role = await RoleModel.findOne({ code: roleDef.code });
    if (!role) {
      role = await RoleModel.create({
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description
      });
      console.log(`✅ Tạo role: ${roleDef.code} — ${roleDef.name}`);
    } else {
      console.log(`⏭  Bỏ qua role (đã có): ${roleDef.code}`);
    }

    for (const permCode of roleDef.permissions) {
      const permission = await PermissionModel.findOne({ code: permCode, isDeleted: false });
      if (!permission) {
        console.warn(`⚠️  Không tìm thấy permission ${permCode}, bỏ qua`);
        continue;
      }
      const link = await RolePermissionModel.findOne({
        role: role._id,
        permission: permission._id
      });
      if (link) {
        if (link.isDeleted) {
          link.isDeleted = false;
          await link.save();
          console.log(`♻️  Khôi phục gán ${permCode} → ${roleDef.code}`);
        }
        continue;
      }
      await RolePermissionModel.create({ role: role._id, permission: permission._id });
      console.log(`✅ Gán ${permCode} → ${roleDef.code}`);
    }
  }

  console.log(
    `\n🎉 Hoàn thành: tạo mới ${created}, cập nhật ${updated}, bỏ qua ${skipped} permission`
  );
  process.exit(0);
};

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
