import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import PermissionCatalogModel, { PermissionActionKind } from "../src/models/PermissionCatalogModel";

interface PermissionDef {
  code: string;
  module: "hrm" | "workplace" | "crm";
  name: string;
  entity: string;
  actionKind: PermissionActionKind;
  validDataScopePolicies: string[];
}

const supportsFieldScope = (actionKind: PermissionActionKind): boolean =>
  actionKind !== "STRUCTURAL";

const EMPLOYEE_SCOPES_MANAGE = ["EMPLOYEE_ALL_COMPANY", "EMPLOYEE_OWN_DEPARTMENT"];
const EMPLOYEE_SCOPES_VIEW = ["EMPLOYEE_ALL_COMPANY", "EMPLOYEE_OWN_DEPARTMENT", "EMPLOYEE_SELF"];
const INTERNAL_FILE_SCOPES = ["INTERNAL_FILE_ALL_COMPANY", "INTERNAL_FILE_OWN_DEPARTMENT"];
const WEEKLY_REPORT_SCOPES_VIEW = ["WEEKLY_REPORT_ALL_COMPANY", "WEEKLY_REPORT_OWN_DEPARTMENT"];
const CUSTOMER_SCOPES_VIEW = ["CUSTOMER_ALL_COMPANY", "CUSTOMER_SELF_ASSIGNED"];
const CUSTOMER_CALL_SCOPES = [
  "CUSTOMER_ALL_COMPANY",
  "CUSTOMER_OWN_DEPARTMENT",
  "CUSTOMER_SELF_ASSIGNED"
];
const CUSTOMER_INTERACTION_SCOPES_VIEW = [
  "CUSTOMER_INTERACTION_ALL_COMPANY",
  "CUSTOMER_INTERACTION_SELF_ASSIGNED"
];
const COMMISSION_SCOPES_VIEW = ["COMMISSION_ALL_COMPANY", "COMMISSION_SELF_ASSIGNED"];
const CALL_LOG_SCOPES = [
  "CALL_LOG_ALL_COMPANY",
  "CALL_LOG_OWN_DEPARTMENT",
  "CALL_LOG_SELF_ASSIGNED"
];
const SALE_OMICALL_PROFILE_SCOPES = ["SALE_OMICALL_PROFILE_ALL_COMPANY"];

const DEFINITIONS: PermissionDef[] = [
  {
    code: "employee.view",
    module: "hrm",
    name: "Xem nhân viên",
    entity: "Employee",
    actionKind: "READ",
    validDataScopePolicies: EMPLOYEE_SCOPES_VIEW
  },
  {
    code: "employee.create",
    module: "hrm",
    name: "Thêm nhân viên",
    entity: "Employee",
    actionKind: "WRITE",
    validDataScopePolicies: EMPLOYEE_SCOPES_MANAGE
  },
  {
    code: "employee.update",
    module: "hrm",
    name: "Sửa thông tin nhân viên",
    entity: "Employee",
    actionKind: "WRITE",
    validDataScopePolicies: EMPLOYEE_SCOPES_MANAGE
  },
  {
    code: "employee.set_status",
    module: "hrm",
    name: "Đổi trạng thái làm việc",
    entity: "Employee",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: EMPLOYEE_SCOPES_MANAGE
  },
  {
    code: "department.view",
    module: "hrm",
    name: "Xem phòng ban",
    entity: "Department",
    actionKind: "READ",
    validDataScopePolicies: ["DEPARTMENT_ALL_COMPANY"]
  },
  {
    code: "department.manage",
    module: "hrm",
    name: "Thêm/sửa phòng ban",
    entity: "Department",
    actionKind: "WRITE",
    validDataScopePolicies: ["DEPARTMENT_ALL_COMPANY"]
  },
  {
    code: "department.delete",
    module: "hrm",
    name: "Xoá phòng ban",
    entity: "Department",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["DEPARTMENT_ALL_COMPANY"]
  },
  {
    code: "position.view",
    module: "hrm",
    name: "Xem vị trí",
    entity: "Position",
    actionKind: "READ",
    validDataScopePolicies: ["POSITION_ALL_COMPANY"]
  },
  {
    code: "position.manage",
    module: "hrm",
    name: "Thêm/sửa vị trí",
    entity: "Position",
    actionKind: "WRITE",
    validDataScopePolicies: ["POSITION_ALL_COMPANY"]
  },
  {
    code: "position.delete",
    module: "hrm",
    name: "Xoá vị trí",
    entity: "Position",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["POSITION_ALL_COMPANY"]
  },
  {
    code: "labor_contract.create",
    module: "hrm",
    name: "Tạo hợp đồng lao động",
    entity: "LaborContract",
    actionKind: "WRITE",
    validDataScopePolicies: ["LABOR_CONTRACT_ALL_COMPANY"]
  },
  {
    code: "attendance.view",
    module: "hrm",
    name: "Xem chấm công",
    entity: "Attendance",
    actionKind: "READ",
    validDataScopePolicies: ["ATTENDANCE_ALL_COMPANY"]
  },
  {
    code: "attendance.import",
    module: "hrm",
    name: "Import dữ liệu chấm công",
    entity: "Attendance",
    actionKind: "WRITE",
    validDataScopePolicies: ["ATTENDANCE_ALL_COMPANY"]
  },
  {
    code: "attendance.edit",
    module: "hrm",
    name: "Sửa dữ liệu chấm công",
    entity: "Attendance",
    actionKind: "WRITE",
    validDataScopePolicies: ["ATTENDANCE_ALL_COMPANY"]
  },
  {
    code: "wifi_config.view",
    module: "hrm",
    name: "Xem cấu hình wifi điểm danh",
    entity: "WifiConfig",
    actionKind: "READ",
    validDataScopePolicies: ["WIFI_CONFIG_ALL_COMPANY"]
  },
  {
    code: "wifi_config.manage",
    module: "hrm",
    name: "Thêm/sửa cấu hình wifi điểm danh",
    entity: "WifiConfig",
    actionKind: "WRITE",
    validDataScopePolicies: ["WIFI_CONFIG_ALL_COMPANY"]
  },
  {
    code: "wifi_config.delete",
    module: "hrm",
    name: "Xoá cấu hình wifi điểm danh",
    entity: "WifiConfig",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["WIFI_CONFIG_ALL_COMPANY"]
  },
  {
    code: "shift_config.view",
    module: "hrm",
    name: "Xem ca làm việc",
    entity: "ShiftConfig",
    actionKind: "READ",
    validDataScopePolicies: ["SHIFT_CONFIG_ALL_COMPANY"]
  },
  {
    code: "shift_config.manage",
    module: "hrm",
    name: "Thêm ca làm việc",
    entity: "ShiftConfig",
    actionKind: "WRITE",
    validDataScopePolicies: ["SHIFT_CONFIG_ALL_COMPANY"]
  },
  {
    code: "payroll.view",
    module: "hrm",
    name: "Xem bảng lương",
    entity: "Payroll",
    actionKind: "READ",
    validDataScopePolicies: ["PAYROLL_ALL_COMPANY"]
  },
  {
    code: "document.view",
    module: "hrm",
    name: "Xem tài liệu hồ sơ",
    entity: "Document",
    actionKind: "READ",
    validDataScopePolicies: ["DOCUMENT_ALL_COMPANY"]
  },
  {
    code: "document_type.manage",
    module: "hrm",
    name: "Quản lý loại tài liệu",
    entity: "DocumentType",
    actionKind: "WRITE",
    validDataScopePolicies: ["DOCUMENT_TYPE_ALL_COMPANY"]
  },
  {
    code: "internal_file.view",
    module: "hrm",
    name: "Xem ổ file nội bộ",
    entity: "InternalFile",
    actionKind: "READ",
    validDataScopePolicies: INTERNAL_FILE_SCOPES
  },
  {
    code: "internal_file.manage",
    module: "hrm",
    name: "Tải lên/sửa file nội bộ",
    entity: "InternalFile",
    actionKind: "WRITE",
    validDataScopePolicies: INTERNAL_FILE_SCOPES
  },
  {
    code: "internal_file.delete",
    module: "hrm",
    name: "Xoá file/thư mục nội bộ",
    entity: "InternalFile",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: INTERNAL_FILE_SCOPES
  },
  {
    code: "internal_file_permission.view",
    module: "hrm",
    name: "Xem phân quyền ổ file nội bộ",
    entity: "InternalFilePermission",
    actionKind: "READ",
    validDataScopePolicies: ["INTERNAL_FILE_PERMISSION_ALL_COMPANY"]
  },
  {
    code: "internal_file_permission.manage",
    module: "hrm",
    name: "Gán/thu hồi quyền ổ file nội bộ",
    entity: "InternalFilePermission",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["INTERNAL_FILE_PERMISSION_ALL_COMPANY"]
  },
  {
    code: "weekly_report.view",
    module: "hrm",
    name: "Xem báo cáo tuần",
    entity: "WeeklyReport",
    actionKind: "READ",
    validDataScopePolicies: WEEKLY_REPORT_SCOPES_VIEW
  },
  {
    code: "weekly_report.submit",
    module: "hrm",
    name: "Nộp báo cáo tuần",
    entity: "WeeklyReport",
    actionKind: "WRITE",
    validDataScopePolicies: ["WEEKLY_REPORT_OWN_DEPARTMENT"]
  },
  {
    code: "holiday.view",
    module: "hrm",
    name: "Xem ngày nghỉ lễ",
    entity: "Holiday",
    actionKind: "READ",
    validDataScopePolicies: ["HOLIDAY_ALL_COMPANY"]
  },
  {
    code: "holiday.manage",
    module: "hrm",
    name: "Thêm/sửa ngày nghỉ lễ",
    entity: "Holiday",
    actionKind: "WRITE",
    validDataScopePolicies: ["HOLIDAY_ALL_COMPANY"]
  },
  {
    code: "holiday.delete",
    module: "hrm",
    name: "Xoá ngày nghỉ lễ",
    entity: "Holiday",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["HOLIDAY_ALL_COMPANY"]
  },
  {
    code: "employment_status.view",
    module: "hrm",
    name: "Xem loại hợp đồng",
    entity: "EmploymentStatus",
    actionKind: "READ",
    validDataScopePolicies: ["EMPLOYMENT_STATUS_ALL_COMPANY"]
  },
  {
    code: "employment_status.manage",
    module: "hrm",
    name: "Thêm/sửa loại hợp đồng",
    entity: "EmploymentStatus",
    actionKind: "WRITE",
    validDataScopePolicies: ["EMPLOYMENT_STATUS_ALL_COMPANY"]
  },
  {
    code: "employment_status.delete",
    module: "hrm",
    name: "Xoá loại hợp đồng",
    entity: "EmploymentStatus",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["EMPLOYMENT_STATUS_ALL_COMPANY"]
  },
  {
    code: "attendance_mapping.view",
    module: "hrm",
    name: "Xem mapping máy chấm công",
    entity: "AttendanceMapping",
    actionKind: "READ",
    validDataScopePolicies: ["ATTENDANCE_MAPPING_ALL_COMPANY"]
  },
  {
    code: "attendance_mapping.manage",
    module: "hrm",
    name: "Thêm/sửa mapping máy chấm công",
    entity: "AttendanceMapping",
    actionKind: "WRITE",
    validDataScopePolicies: ["ATTENDANCE_MAPPING_ALL_COMPANY"]
  },
  {
    code: "attendance_mapping.delete",
    module: "hrm",
    name: "Xoá mapping máy chấm công",
    entity: "AttendanceMapping",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["ATTENDANCE_MAPPING_ALL_COMPANY"]
  },
  {
    code: "branch.view",
    module: "hrm",
    name: "Xem chi nhánh",
    entity: "Branch",
    actionKind: "READ",
    validDataScopePolicies: ["BRANCH_ALL_COMPANY"]
  },
  {
    code: "branch.manage",
    module: "hrm",
    name: "Thêm/sửa chi nhánh",
    entity: "Branch",
    actionKind: "WRITE",
    validDataScopePolicies: ["BRANCH_ALL_COMPANY"]
  },
  {
    code: "branch.delete",
    module: "hrm",
    name: "Xoá chi nhánh",
    entity: "Branch",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["BRANCH_ALL_COMPANY"]
  },
  {
    code: "request.view",
    module: "hrm",
    name: "Xem đơn từ",
    entity: "Request",
    actionKind: "READ",
    validDataScopePolicies: ["REQUEST_ALL_COMPANY", "REQUEST_SELF"]
  },
  {
    code: "request.create",
    module: "hrm",
    name: "Tạo đơn từ",
    entity: "Request",
    actionKind: "WRITE",
    validDataScopePolicies: ["REQUEST_SELF"]
  },
  {
    code: "request.cancel",
    module: "hrm",
    name: "Huỷ đơn từ",
    entity: "Request",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["REQUEST_SELF"]
  },
  {
    // Data Scope ở đây chỉ mang tính hình thức (PermissionGrant bắt buộc có dataScopePolicyCode) —
    // lọc "đơn nào được duyệt" thực chất do getApprovalChain() xử lý riêng, không qua Data Scope
    // (xem docs/PERMISSION-MODULE-PLAN.md, quyết định A ở Phase 6).
    code: "request.review",
    module: "hrm",
    name: "Duyệt/từ chối đơn từ",
    entity: "Request",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["REQUEST_ALL_COMPANY"]
  },

  // ==================== Workplace ====================
  {
    code: "post.view",
    module: "workplace",
    name: "Xem bảng tin",
    entity: "Post",
    actionKind: "READ",
    validDataScopePolicies: ["POST_ALL_COMPANY"]
  },
  {
    code: "post.create",
    module: "workplace",
    name: "Đăng bài",
    entity: "Post",
    actionKind: "WRITE",
    validDataScopePolicies: ["POST_ALL_COMPANY"]
  },
  {
    code: "post.edit",
    module: "workplace",
    name: "Sửa bài đăng",
    entity: "Post",
    actionKind: "WRITE",
    validDataScopePolicies: ["POST_SELF_ASSIGNED"]
  },
  {
    code: "post.delete",
    module: "workplace",
    name: "Xoá bài đăng",
    entity: "Post",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["POST_ALL_COMPANY", "POST_SELF_ASSIGNED"]
  },
  {
    code: "post.pin",
    module: "workplace",
    name: "Ghim bài đăng",
    entity: "Post",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["POST_ALL_COMPANY"]
  },
  {
    code: "post_comment.create",
    module: "workplace",
    name: "Bình luận bài đăng",
    entity: "PostComment",
    actionKind: "WRITE",
    validDataScopePolicies: ["POST_COMMENT_ALL_COMPANY"]
  },
  {
    code: "post_comment.delete",
    module: "workplace",
    name: "Xoá bình luận",
    entity: "PostComment",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["POST_COMMENT_ALL_COMPANY"]
  },
  {
    code: "shared_folder.view",
    module: "workplace",
    name: "Xem thư mục dùng chung",
    entity: "SharedFolder",
    actionKind: "READ",
    validDataScopePolicies: ["SHARED_FOLDER_ALL_COMPANY"]
  },
  {
    code: "shared_folder.manage",
    module: "workplace",
    name: "Tải lên/sửa thư mục dùng chung",
    entity: "SharedFolder",
    actionKind: "WRITE",
    validDataScopePolicies: ["SHARED_FOLDER_ALL_COMPANY"]
  },
  {
    code: "shared_folder.delete",
    module: "workplace",
    name: "Xoá file/thư mục dùng chung",
    entity: "SharedFolder",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["SHARED_FOLDER_ALL_COMPANY"]
  },
  {
    code: "shared_folder_permission.manage",
    module: "workplace",
    name: "Quản lý phân quyền thư mục dùng chung",
    entity: "SharedFolderPermission",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["SHARED_FOLDER_PERMISSION_ALL_COMPANY"]
  },
  {
    code: "shared_folder_audit_log.view",
    module: "workplace",
    name: "Xem nhật ký thư mục dùng chung",
    entity: "SharedFolderAuditLog",
    actionKind: "READ",
    validDataScopePolicies: ["SHARED_FOLDER_AUDIT_LOG_ALL_COMPANY"]
  },
  {
    code: "shared_folder_audit_log.delete",
    module: "workplace",
    name: "Xoá nhật ký thư mục dùng chung",
    entity: "SharedFolderAuditLog",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["SHARED_FOLDER_AUDIT_LOG_ALL_COMPANY"]
  },
  {
    code: "kpi_metric.view",
    module: "workplace",
    name: "Xem chỉ tiêu KPI",
    entity: "KpiMetric",
    actionKind: "READ",
    validDataScopePolicies: ["KPI_METRIC_ALL_COMPANY"]
  },
  {
    code: "kpi_metric.manage",
    module: "workplace",
    name: "Thêm/sửa chỉ tiêu KPI",
    entity: "KpiMetric",
    actionKind: "WRITE",
    validDataScopePolicies: ["KPI_METRIC_ALL_COMPANY"]
  },
  {
    code: "kpi_metric.delete",
    module: "workplace",
    name: "Xoá chỉ tiêu KPI",
    entity: "KpiMetric",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["KPI_METRIC_ALL_COMPANY"]
  },
  {
    code: "print_job.view",
    module: "workplace",
    name: "Xem lịch sử in",
    entity: "PrintJob",
    actionKind: "READ",
    validDataScopePolicies: ["PRINT_JOB_ALL_COMPANY"]
  },
  {
    code: "print_job.create",
    module: "workplace",
    name: "Gửi lệnh in",
    entity: "PrintJob",
    actionKind: "WRITE",
    validDataScopePolicies: ["PRINT_JOB_ALL_COMPANY"]
  },

  // ==================== CRM ====================
  {
    code: "customer.view",
    module: "crm",
    name: "Xem khách hàng",
    entity: "Customer",
    actionKind: "READ",
    validDataScopePolicies: CUSTOMER_SCOPES_VIEW
  },
  {
    code: "customer.assign",
    module: "crm",
    name: "Gán/chuyển sale phụ trách khách hàng",
    entity: "Customer",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["CUSTOMER_ALL_COMPANY"]
  },
  {
    code: "customer.claim",
    module: "crm",
    name: "Nhận khách hàng chưa ai phụ trách",
    entity: "Customer",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["CUSTOMER_ALL_COMPANY"]
  },
  {
    code: "customer.ai_insight",
    module: "crm",
    name: "Xem phân tích AI về khách hàng",
    entity: "Customer",
    actionKind: "READ",
    validDataScopePolicies: CUSTOMER_SCOPES_VIEW
  },
  {
    code: "customer_call.view",
    module: "crm",
    name: "Xem danh sách khách hàng cần gọi",
    entity: "Customer",
    actionKind: "READ",
    validDataScopePolicies: CUSTOMER_CALL_SCOPES
  },
  {
    code: "call_log.view",
    module: "crm",
    name: "Xem lịch sử cuộc gọi",
    entity: "CallLog",
    actionKind: "READ",
    validDataScopePolicies: CALL_LOG_SCOPES
  },
  {
    code: "customer_call.initiate",
    module: "crm",
    name: "Kích hoạt SDK gọi điện (lấy SIP credentials)",
    entity: "SaleOmicallProfile",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: SALE_OMICALL_PROFILE_SCOPES
  },
  {
    code: "customer_call.update_relationship_status",
    module: "crm",
    name: "Cập nhật tình trạng kết bạn (Sale) với khách hàng",
    entity: "Customer",
    actionKind: "WRITE",
    validDataScopePolicies: CUSTOMER_CALL_SCOPES
  },
  {
    code: "customer_interaction.view",
    module: "crm",
    name: "Xem lịch sử tương tác khách hàng",
    entity: "CustomerInteraction",
    actionKind: "READ",
    validDataScopePolicies: CUSTOMER_INTERACTION_SCOPES_VIEW
  },
  {
    code: "customer_interaction.create",
    module: "crm",
    name: "Ghi nhận tương tác khách hàng",
    entity: "CustomerInteraction",
    actionKind: "WRITE",
    validDataScopePolicies: ["CUSTOMER_INTERACTION_ALL_COMPANY"]
  },
  {
    code: "agent.view",
    module: "crm",
    name: "Xem đại lý",
    entity: "Agent",
    actionKind: "READ",
    validDataScopePolicies: ["AGENT_ALL_COMPANY"]
  },
  {
    code: "investment.view",
    module: "crm",
    name: "Xem khoản đầu tư",
    entity: "Investment",
    actionKind: "READ",
    validDataScopePolicies: ["INVESTMENT_ALL_COMPANY"]
  },
  {
    code: "commission.view",
    module: "crm",
    name: "Xem hoa hồng",
    entity: "Commission",
    actionKind: "READ",
    validDataScopePolicies: COMMISSION_SCOPES_VIEW
  },
  {
    code: "claim_period.view",
    module: "crm",
    name: "Xem kỳ claim hoa hồng",
    entity: "ClaimPeriod",
    actionKind: "READ",
    validDataScopePolicies: ["CLAIM_PERIOD_ALL_COMPANY"]
  },
  {
    code: "claim_period.manage",
    module: "crm",
    name: "Tạo kỳ claim hoa hồng",
    entity: "ClaimPeriod",
    actionKind: "WRITE",
    validDataScopePolicies: ["CLAIM_PERIOD_ALL_COMPANY"]
  },
  {
    code: "claim_period.close",
    module: "crm",
    name: "Chốt kỳ claim hoa hồng",
    entity: "ClaimPeriod",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["CLAIM_PERIOD_ALL_COMPANY"]
  },
  {
    code: "customer_claim_request.view",
    module: "crm",
    name: "Xem yêu cầu nhận khách",
    entity: "CustomerClaimRequest",
    actionKind: "READ",
    validDataScopePolicies: ["CUSTOMER_CLAIM_REQUEST_ALL_COMPANY"]
  },
  {
    code: "customer_claim_request.create",
    module: "crm",
    name: "Gửi yêu cầu nhận khách",
    entity: "CustomerClaimRequest",
    actionKind: "WRITE",
    validDataScopePolicies: ["CUSTOMER_CLAIM_REQUEST_ALL_COMPANY"]
  },
  {
    code: "customer_claim_request.review",
    module: "crm",
    name: "Duyệt/từ chối yêu cầu nhận khách",
    entity: "CustomerClaimRequest",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["CUSTOMER_CLAIM_REQUEST_ALL_COMPANY"]
  },
  {
    code: "customer_claim_request.revoke",
    module: "crm",
    name: "Thu hồi yêu cầu nhận khách đã duyệt",
    entity: "CustomerClaimRequest",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["CUSTOMER_CLAIM_REQUEST_ALL_COMPANY"]
  },
  {
    code: "transaction.view",
    module: "crm",
    name: "Xem giao dịch nạp tiền",
    entity: "Transaction",
    actionKind: "READ",
    validDataScopePolicies: ["TRANSACTION_ALL_COMPANY"]
  },
  {
    code: "transaction.create",
    module: "crm",
    name: "Tạo giao dịch nạp tiền hộ khách",
    entity: "Transaction",
    actionKind: "WRITE",
    validDataScopePolicies: ["TRANSACTION_ALL_COMPANY"]
  },
  {
    code: "dashboard_metric.view",
    module: "crm",
    name: "Xem dashboard kinh doanh",
    entity: "DashboardMetric",
    actionKind: "READ",
    validDataScopePolicies: ["DASHBOARD_METRIC_ALL_COMPANY"]
  },
  {
    code: "ai_chat.use",
    module: "crm",
    name: "Dùng AI chat hỗ trợ CRM",
    entity: "AiChat",
    actionKind: "WRITE",
    validDataScopePolicies: ["AI_CHAT_ALL_COMPANY"]
  },
  {
    code: "app_integration.manage",
    module: "crm",
    name: "Quản lý app tích hợp",
    entity: "AppIntegration",
    actionKind: "WRITE",
    validDataScopePolicies: ["APP_INTEGRATION_ALL_COMPANY"]
  }
];

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const def of DEFINITIONS) {
    const existing = await PermissionCatalogModel.findOne({ code: def.code });
    const payload = {
      module: def.module,
      name: def.name,
      entity: def.entity,
      actionKind: def.actionKind,
      supportsFieldScope: supportsFieldScope(def.actionKind),
      validDataScopePolicies: def.validDataScopePolicies,
      isDeleted: false
    };

    if (!existing) {
      await PermissionCatalogModel.create({ code: def.code, ...payload });
      console.log(`✅ Tạo permission: ${def.code}`);
      created++;
      continue;
    }

    const existingPlain = existing.toObject();
    const isSame =
      !existing.isDeleted &&
      existingPlain.module === payload.module &&
      existingPlain.name === payload.name &&
      existingPlain.entity === payload.entity &&
      existingPlain.actionKind === payload.actionKind &&
      existingPlain.supportsFieldScope === payload.supportsFieldScope &&
      isEqual(existingPlain.validDataScopePolicies, payload.validDataScopePolicies);

    if (isSame) {
      console.log(`⏭  Bỏ qua (đã đúng): ${def.code}`);
      skipped++;
      continue;
    }

    await PermissionCatalogModel.updateOne({ _id: existing._id }, { $set: payload });
    console.log(`♻️  Cập nhật permission: ${def.code}`);
    updated++;
  }

  console.log(
    `\n🎉 Hoàn thành: tạo mới ${created}, cập nhật ${updated}, bỏ qua ${skipped} (tổng ${DEFINITIONS.length})`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
