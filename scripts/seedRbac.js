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
    code: PERMISSION.HRM_EMPLOYEE_VIEW,
    description: "Xem danh sách nhân viên"
  },
  {
    code: PERMISSION.HRM_EMPLOYEE_EDIT,
    description: "Thêm/sửa thông tin nhân viên"
  },
  {
    code: PERMISSION.HRM_MENU_ATTENDANCE_SETTINGS,
    description: "Xem menu Quản lý chấm công (ca làm, WiFi)"
  },
  { code: PERMISSION.HRM_MENU_DEPARTMENT, description: "Xem menu Khối / Phòng ban" },
  { code: PERMISSION.HRM_MENU_BRANCH, description: "Xem menu Chi nhánh" },
  { code: PERMISSION.HRM_MENU_WORK_UNIT, description: "Xem menu Công & Chấm công" },
  { code: PERMISSION.HRM_MENU_EVENTS, description: "Xem menu Sự kiện & Lịch" },
  { code: PERMISSION.HRM_MENU_DOCUMENTS, description: "Xem menu Hồ sơ đính kèm" },
  { code: PERMISSION.HRM_MENU_POSITIONS, description: "Xem menu Vị trí / Chức vụ" },
  {
    code: PERMISSION.HRM_MENU_ATTENDANCE_MAPPING,
    description: "Xem menu Mapping máy chấm công"
  },
  { code: PERMISSION.HRM_MENU_PERMISSIONS, description: "Xem menu Phân quyền" },
  { code: PERMISSION.HRM_MENU_PERMISSIONS_RBAC, description: "Xem menu Phân quyền chi tiết" },
  { code: PERMISSION.HRM_MENU_HR_MANAGEMENT, description: "Xem menu Quản lý nhân sự" },
  { code: PERMISSION.HRM_MENU_EMPLOYEE, description: "Xem menu Danh sách nhân sự" },
  { code: PERMISSION.HRM_MENU_LABOR_CONTRACT, description: "Xem menu Hợp đồng lao động" },
  { code: PERMISSION.HRM_MENU_RECRUITMENT, description: "Xem menu Tuyển dụng" },
  { code: PERMISSION.HRM_MENU_RECRUITMENT_PLAN, description: "Xem menu Kế hoạch tuyển dụng" },
  { code: PERMISSION.HRM_MENU_CANDIDATE_PROFILE, description: "Xem menu Hồ sơ ứng viên" },
  { code: PERMISSION.HRM_MENU_TRAINING, description: "Xem menu Đào tạo" },
  { code: PERMISSION.HRM_MENU_TRAINING_PLAN, description: "Xem menu Kế hoạch đào tạo" },
  { code: PERMISSION.HRM_MENU_TRAINEE_MANAGEMENT, description: "Xem menu Quản lý học viên" },
  { code: PERMISSION.HRM_MENU_REGULATION_DOCUMENT, description: "Xem menu Nội quy & Văn bản" },
  { code: PERMISSION.HRM_MENU_REGULATION, description: "Xem menu Nội quy" },
  { code: PERMISSION.HRM_MENU_DOCUMENT_MANAGEMENT, description: "Xem menu Quản lý văn bản" },
  { code: PERMISSION.HRM_MENU_PERFORMANCE, description: "Xem menu Quản lý hiệu suất" },
  { code: PERMISSION.HRM_MENU_KPI, description: "Xem menu Quản lý KPI" },
  { code: PERMISSION.HRM_MENU_TASK_REPORT, description: "Xem menu Công việc & Báo cáo" },
  { code: PERMISSION.HRM_MENU_ASSET_MANAGEMENT, description: "Xem menu Quản lý tài sản & VPP" },
  { code: PERMISSION.HRM_MENU_ASSET_LIST, description: "Xem menu DS tài sản" },
  { code: PERMISSION.HRM_MENU_ASSET_REQUEST, description: "Xem menu Đề nghị cấp tài sản" },
  { code: PERMISSION.HRM_MENU_SYSTEM_SETTINGS, description: "Xem menu Cài đặt hệ thống" },
  { code: PERMISSION.FOLDER_MENU_DOCUMENTS, description: "Xem menu Tài liệu nội bộ" },
  { code: PERMISSION.FOLDER_SHARED_VIEW, description: "Xem thư mục/hồ sơ dùng chung" },
  { code: PERMISSION.FOLDER_SHARED_DOWNLOAD, description: "Tải hồ sơ dùng chung" },
  { code: PERMISSION.FOLDER_SHARED_UPLOAD, description: "Tải hồ sơ lên thư mục dùng chung" },
  { code: PERMISSION.FOLDER_SHARED_PUSH, description: "Đẩy hồ sơ lên thư mục dùng chung" },
  { code: PERMISSION.FOLDER_SHARED_DELETE_FILE, description: "Xóa hồ sơ trong thư mục dùng chung" },
  { code: PERMISSION.FOLDER_SHARED_CREATE, description: "Tạo thư mục dùng chung liên phòng ban" },
  {
    code: PERMISSION.FOLDER_SHARED_MANAGE,
    description: "Quản lý thư mục dùng chung (sửa/xóa/phân quyền)"
  }
];

const DEPRECATED_PERMISSION_CODES = [
  "hrm.menu.view_data",
  "hrm.menu.admin",
  "hrm.menu.system",
  "hrm.menu.attendance_overview",
  "hrm.menu.payroll",
  "hrm.menu.reports",
  "hrm.menu.settings",
  "hrm.menu.logs",
  "hrm.menu.help"
];

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
  },
  {
    code: "shared_folder_viewer",
    name: "Xem tài liệu dùng chung",
    description:
      "Mặc định toàn thể CBNV VNFITE 3 miền — chỉ xem tài liệu trong thư mục dùng chung, không được tải",
    permissions: [PERMISSION.FOLDER_MENU_DOCUMENTS, PERMISSION.FOLDER_SHARED_VIEW]
  },
  {
    code: "shared_folder_manager",
    name: "Quản lý tài liệu dùng chung",
    description: "Toàn quyền tạo, sửa, xóa, phân quyền thư mục dùng chung",
    permissions: [
      PERMISSION.FOLDER_MENU_DOCUMENTS,
      PERMISSION.FOLDER_SHARED_VIEW,
      PERMISSION.FOLDER_SHARED_DOWNLOAD,
      PERMISSION.FOLDER_SHARED_UPLOAD,
      PERMISSION.FOLDER_SHARED_PUSH,
      PERMISSION.FOLDER_SHARED_DELETE_FILE,
      PERMISSION.FOLDER_SHARED_CREATE,
      PERMISSION.FOLDER_SHARED_MANAGE
    ]
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
