import "dotenv/config";
import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import EntityAttributeCatalogModel, {
  AttributeDefDoc,
  FieldDefDoc
} from "../src/models/EntityAttributeCatalogModel";

interface EntityAttributeCatalogDef {
  entity: string;
  subjectAttributes: AttributeDefDoc[];
  resourceAttributes: AttributeDefDoc[];
  fields: FieldDefDoc[];
}

const DEFINITIONS: EntityAttributeCatalogDef[] = [
  {
    entity: "Employee",
    subjectAttributes: [
      { path: "subject.userId", label: "ID nhân viên (chính mình)", type: "reference" },
      {
        path: "subject.departmentIds",
        label: "Danh sách phòng ban đang thuộc về",
        type: "reference"
      }
    ],
    resourceAttributes: [
      { path: "resource._id", label: "ID nhân viên", type: "reference" },
      {
        path: "resource.departmentId",
        label: "Phòng ban hiện tại (cần $lookup qua user_department_position lúc query)",
        type: "reference"
      },
      {
        path: "resource.employment_status",
        label: "Trạng thái làm việc",
        type: "reference"
      }
    ],
    fields: [
      { name: "full_name", label: "Họ tên" },
      { name: "cccd", label: "CCCD" },
      { name: "phone_number", label: "Số điện thoại" },
      { name: "sex", label: "Giới tính" },
      { name: "date_of_birth", label: "Ngày sinh" },
      { name: "address", label: "Địa chỉ" },
      { name: "tinh_trang_hon_nhan", label: "Tình trạng hôn nhân" },
      { name: "ma_nv", label: "Mã nhân viên" },
      { name: "employment_type", label: "Loại hình làm việc" },
      { name: "employment_status", label: "Trạng thái làm việc" },
      { name: "start_date", label: "Ngày vào làm" },
      { name: "probation_end_date", label: "Ngày hết thử việc" },
      { name: "resignation_date", label: "Ngày nghỉ việc" },
      { name: "branch_id", label: "Chi nhánh" }
    ]
  },
  {
    entity: "Request",
    subjectAttributes: [
      { path: "subject.userId", label: "ID nhân viên (chính mình)", type: "reference" }
    ],
    resourceAttributes: [
      { path: "resource.user_id", label: "Người tạo đơn", type: "reference" },
      {
        path: "resource.status",
        label: "Trạng thái đơn",
        type: "enum",
        options: ["pending", "approved", "rejected", "cancelled"]
      },
      { path: "resource.request_type", label: "Loại đơn", type: "string" }
    ],
    fields: [
      { name: "status", label: "Trạng thái" },
      { name: "reason", label: "Lý do" },
      { name: "reviewed_by", label: "Người duyệt" },
      { name: "reviewed_at", label: "Thời điểm duyệt" },
      { name: "reviewer_note", label: "Ghi chú của người duyệt" }
    ]
  },
  {
    entity: "Customer",
    subjectAttributes: [
      { path: "subject.userId", label: "ID nhân viên (chính mình)", type: "reference" },
      {
        path: "subject.departmentColleagueUserIds",
        label: "Danh sách user cùng phòng ban",
        type: "reference"
      }
    ],
    resourceAttributes: [
      {
        path: "resource.referred_by",
        label: "Sale giới thiệu (chủ sở hữu khách hàng)",
        type: "reference"
      },
      {
        path: "resource.status",
        label: "Trạng thái khách hàng",
        type: "enum",
        options: [
          "registered",
          "kyc_pending",
          "kyc_verified",
          "kyc_rejected",
          "active",
          "inactive",
          "blocked"
        ]
      },
      {
        path: "resource.source_type",
        label: "Nguồn khách hàng",
        type: "enum",
        options: ["sale", "agent", "marketing"]
      },
      { path: "resource.agent_id", label: "Đại lý giới thiệu", type: "reference" }
    ],
    fields: [
      { name: "phone_number", label: "Số điện thoại" },
      { name: "identity", label: "Thông tin định danh (eKYC)" },
      { name: "bank_accounts", label: "Tài khoản ngân hàng" },
      { name: "status", label: "Trạng thái" },
      { name: "source_type", label: "Nguồn khách hàng" },
      { name: "ref_code", label: "Mã giới thiệu" },
      { name: "registeredAt", label: "Ngày đăng ký" }
    ]
  },
  {
    entity: "Commission",
    subjectAttributes: [
      { path: "subject.userId", label: "ID nhân viên (chính mình)", type: "reference" }
    ],
    resourceAttributes: [
      { path: "resource.commission.sale_id", label: "Sale hưởng hoa hồng", type: "reference" },
      {
        path: "resource.commission.status",
        label: "Trạng thái hoa hồng",
        type: "enum",
        options: ["none", "pending"]
      },
      { path: "resource.commission.period_month", label: "Tháng kỳ hoa hồng", type: "number" },
      { path: "resource.commission.period_year", label: "Năm kỳ hoa hồng", type: "number" }
    ],
    fields: [
      { name: "commission.gross_amount", label: "Hoa hồng gộp" },
      { name: "commission.tncn_amount", label: "Thuế TNCN khấu trừ" },
      { name: "commission.net_amount", label: "Hoa hồng thực nhận" },
      { name: "commission.status", label: "Trạng thái hoa hồng" },
      { name: "commission.receiver_type", label: "Loại người nhận" }
    ]
  },
  {
    entity: "WeeklyReport",
    subjectAttributes: [
      {
        path: "subject.departmentIds",
        label: "Danh sách phòng ban đang thuộc về",
        type: "reference"
      }
    ],
    resourceAttributes: [
      { path: "resource.department", label: "Phòng ban báo cáo", type: "reference" },
      {
        path: "resource.status",
        label: "Trạng thái nộp báo cáo",
        type: "enum",
        options: ["pending", "submitted", "late", "missing"]
      },
      { path: "resource.weekStart", label: "Tuần báo cáo", type: "string" }
    ],
    fields: [
      { name: "status", label: "Trạng thái" },
      { name: "weekStart", label: "Tuần bắt đầu" },
      { name: "deadline", label: "Hạn nộp" },
      { name: "submittedAt", label: "Thời điểm nộp" },
      { name: "submittedBy", label: "Người nộp" },
      { name: "note", label: "Ghi chú" }
    ]
  },
  {
    entity: "InternalFile",
    subjectAttributes: [
      {
        path: "subject.departmentIds",
        label: "Danh sách phòng ban đang thuộc về",
        type: "reference"
      }
    ],
    resourceAttributes: [
      { path: "resource.department", label: "Phòng ban sở hữu file", type: "reference" },
      {
        path: "resource.category",
        label: "Loại file",
        type: "enum",
        options: ["general", "weekly_report"]
      },
      { path: "resource.uploadedBy", label: "Người tải lên", type: "reference" }
    ],
    fields: [
      { name: "originalName", label: "Tên file gốc" },
      { name: "filename", label: "Tên file lưu trên đĩa" },
      { name: "category", label: "Loại file" },
      { name: "mimeType", label: "Định dạng" },
      { name: "size", label: "Dung lượng" },
      { name: "uploadedBy", label: "Người tải lên" },
      { name: "subfolder", label: "Thư mục con" }
    ]
  },
  {
    entity: "Post",
    subjectAttributes: [
      { path: "subject.accountId", label: "ID tài khoản (chính mình)", type: "reference" }
    ],
    resourceAttributes: [
      { path: "resource.author_id", label: "Người đăng bài", type: "reference" },
      {
        path: "resource.dept_id",
        label: "Phòng ban (nếu visibility=department)",
        type: "reference"
      },
      {
        path: "resource.visibility",
        label: "Phạm vi hiển thị",
        type: "enum",
        options: ["all", "department"]
      },
      {
        path: "resource.type",
        label: "Loại bài đăng",
        type: "enum",
        options: ["post", "announcement"]
      }
    ],
    fields: [
      { name: "content", label: "Nội dung" },
      { name: "images", label: "Hình ảnh" },
      { name: "type", label: "Loại bài đăng" },
      { name: "visibility", label: "Phạm vi hiển thị" },
      { name: "pinned", label: "Đã ghim" }
    ]
  },

  {
    entity: "Department",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "department_name", label: "Tên phòng ban" },
      { name: "department_code", label: "Mã phòng ban" },
      { name: "description", label: "Mô tả" },
      { name: "type", label: "Loại đơn vị" },
      { name: "address", label: "Địa chỉ" },
      { name: "parent", label: "Đơn vị cha" },
      { name: "is_active", label: "Đang hoạt động" },
      { name: "manager", label: "Quản lý phụ trách" }
    ]
  },
  {
    entity: "Position",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "position_name", label: "Tên vị trí" },
      { name: "description", label: "Mô tả" }
    ]
  },
  {
    entity: "LaborContract",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "contract_number", label: "Số hợp đồng" },
      { name: "start_date", label: "Ngày bắt đầu" },
      { name: "end_date", label: "Ngày kết thúc" },
      { name: "type", label: "Loại hợp đồng" },
      { name: "status", label: "Trạng thái" },
      { name: "file_url", label: "File hợp đồng" },
      { name: "note", label: "Ghi chú" },
      { name: "created_by", label: "Người tạo" }
    ]
  },
  {
    entity: "Attendance",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "date", label: "Ngày công" },
      { name: "shifts", label: "Ca làm việc" },
      { name: "check_in", label: "Giờ vào" },
      { name: "check_out", label: "Giờ ra" },
      { name: "minutes_late", label: "Số phút đi muộn" },
      { name: "minute_early", label: "Số phút về sớm" },
      { name: "work_unit", label: "Công tính được" },
      { name: "penalty_amount", label: "Số tiền phạt" },
      { name: "edited_by", label: "Người chỉnh sửa" },
      { name: "edited_at", label: "Thời điểm chỉnh sửa" }
    ]
  },
  {
    entity: "WifiConfig",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "name", label: "Tên điểm wifi" },
      { name: "ssid", label: "SSID" },
      { name: "latitude", label: "Vĩ độ" },
      { name: "longitude", label: "Kinh độ" },
      { name: "radius", label: "Bán kính hợp lệ (m)" }
    ]
  },
  {
    entity: "ShiftConfig",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "name", label: "Tên ca" },
      { name: "start_time", label: "Giờ bắt đầu" },
      { name: "end_time", label: "Giờ kết thúc" },
      { name: "late_allowance_minutes", label: "Số phút miễn trừ đi muộn" }
    ]
  },
  {
    entity: "Payroll",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "work_unit_total", label: "Tổng công" },
      { name: "work_unit_official", label: "Công chính thức" },
      { name: "work_unit_probation", label: "Công thử việc" },
      { name: "penalty_amount_total", label: "Tổng tiền phạt" },
      { name: "present_days", label: "Số ngày có mặt" },
      { name: "missed_clock_days", label: "Số ngày quên chấm công" },
      { name: "absent_days", label: "Số ngày vắng" },
      { name: "leave_paid_days", label: "Số ngày nghỉ phép có lương" },
      { name: "leave_unpaid_days", label: "Số ngày nghỉ không lương" },
      { name: "remote_days", label: "Số ngày làm từ xa" },
      { name: "business_trip_days", label: "Số ngày công tác" },
      { name: "client_visit_days", label: "Số ngày gặp khách hàng" },
      { name: "late_days", label: "Số ngày đi muộn" },
      { name: "total_minutes_late", label: "Tổng số phút đi muộn" },
      { name: "early_days", label: "Số ngày về sớm" },
      { name: "total_minutes_early", label: "Tổng số phút về sớm" }
    ]
  },
  {
    entity: "Document",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "file_name", label: "Tên file" },
      { name: "file_url", label: "Đường dẫn file" },
      { name: "uploaded_at", label: "Thời điểm tải lên" },
      { name: "uploaded_by", label: "Người tải lên" },
      { name: "type_id", label: "Loại tài liệu" },
      { name: "note", label: "Ghi chú" }
    ]
  },
  {
    entity: "DocumentType",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "name", label: "Tên loại tài liệu" },
      { name: "description", label: "Mô tả" },
      { name: "required", label: "Bắt buộc" }
    ]
  },
  {
    entity: "InternalFilePermission",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "department", label: "Phòng ban" },
      { name: "grantedUsers", label: "Tài khoản được cấp quyền" },
      { name: "grantedDepts", label: "Phòng ban được cấp quyền" }
    ]
  },
  {
    entity: "Holiday",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "date", label: "Ngày nghỉ" },
      { name: "name", label: "Tên ngày lễ" },
      { name: "year", label: "Năm" },
      { name: "duration_days", label: "Số ngày nghỉ" },
      { name: "scope_type", label: "Phạm vi áp dụng" },
      { name: "branches", label: "Chi nhánh áp dụng" },
      { name: "pay_policy", label: "Chính sách lương" }
    ]
  },
  {
    entity: "EmploymentStatus",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "name", label: "Tên loại hợp đồng" },
      { name: "code", label: "Mã" },
      { name: "accrues_annual_leave", label: "Được tích lũy phép năm" },
      { name: "can_use_annual_leave", label: "Được dùng phép năm" },
      { name: "retroactive_on_promote", label: "Hồi tố khi chuyển chính thức" },
      { name: "isActive", label: "Đang áp dụng" }
    ]
  },
  {
    entity: "AttendanceMapping",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "machine_code", label: "Mã máy chấm công" },
      { name: "user_id", label: "Nhân viên" }
    ]
  },
  {
    entity: "Branch",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "branch_name", label: "Tên chi nhánh" },
      { name: "branch_code", label: "Mã chi nhánh" },
      { name: "address", label: "Địa chỉ" },
      { name: "is_active", label: "Đang hoạt động" }
    ]
  },
  {
    entity: "PostComment",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "content", label: "Nội dung" },
      { name: "image", label: "Hình ảnh" },
      { name: "author_name", label: "Người bình luận" }
    ]
  },
  {
    entity: "SharedFolder",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "name", label: "Tên thư mục" },
      { name: "description", label: "Mô tả" },
      { name: "scope", label: "Phạm vi hiển thị" },
      { name: "visibleDepartments", label: "Phòng ban được xem" },
      { name: "defaultActions", label: "Hành động mặc định" },
      { name: "autoCleanup", label: "Tự động dọn dẹp" },
      { name: "autoCleanupDays", label: "Số ngày tự động dọn dẹp" },
      { name: "createdBy", label: "Người tạo" }
    ]
  },
  {
    entity: "SharedFolderPermission",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "subjectType", label: "Loại đối tượng (user/department)" },
      { name: "subjectId", label: "Đối tượng được cấp quyền" },
      { name: "actions", label: "Hành động được phép" }
    ]
  },
  {
    entity: "SharedFolderAuditLog",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "action", label: "Hành động" },
      { name: "targetType", label: "Loại đối tượng (folder/file)" },
      { name: "targetName", label: "Tên đối tượng" },
      { name: "performedBy", label: "Người thực hiện" },
      { name: "message", label: "Ghi chú" }
    ]
  },
  {
    entity: "KpiMetric",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "code", label: "Mã chỉ tiêu" },
      { name: "name", label: "Tên chỉ tiêu" },
      { name: "group", label: "Nhóm KPI" },
      { name: "unit", label: "Đơn vị" },
      { name: "source", label: "Nguồn dữ liệu" },
      { name: "auto_source", label: "Nguồn tự động" },
      { name: "description", label: "Mô tả" },
      { name: "is_active", label: "Đang áp dụng" }
    ]
  },
  {
    entity: "PrintJob",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "username", label: "Người gửi lệnh in" },
      { name: "filename", label: "Tên file" },
      { name: "pages", label: "Số trang" },
      { name: "copies", label: "Số bản in" },
      { name: "duplex", label: "In 2 mặt" },
      { name: "totalSheets", label: "Tổng số tờ" },
      { name: "paperSize", label: "Khổ giấy" }
    ]
  },
  {
    entity: "Agent",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "agent_code", label: "Mã đại lý" },
      { name: "agent_type", label: "Loại đại lý" },
      { name: "full_name", label: "Tên đại lý" },
      { name: "phone_number", label: "Số điện thoại" },
      { name: "email", label: "Email" },
      { name: "address", label: "Địa chỉ" },
      { name: "is_active", label: "Đang hoạt động" },
      { name: "branch_name", label: "Chi nhánh" }
    ]
  },
  {
    entity: "Investment",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "product_name", label: "Tên sản phẩm đầu tư" },
      { name: "amount", label: "Số tiền" },
      { name: "term_type", label: "Loại kỳ hạn" },
      { name: "term_value", label: "Giá trị kỳ hạn" },
      { name: "interest_rate", label: "Lãi suất" },
      { name: "invested_at", label: "Ngày đầu tư" },
      { name: "maturity_at", label: "Ngày đáo hạn" },
      { name: "status", label: "Trạng thái" },
      { name: "commission.receiver_type", label: "Loại người nhận hoa hồng" },
      { name: "commission.gross_amount", label: "Hoa hồng gộp" },
      { name: "commission.net_amount", label: "Hoa hồng thực nhận" },
      { name: "commission.status", label: "Trạng thái hoa hồng" }
    ]
  },
  {
    entity: "ClaimPeriod",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "start_at", label: "Ngày bắt đầu" },
      { name: "end_at", label: "Ngày kết thúc" },
      { name: "is_active", label: "Đang mở" },
      { name: "note", label: "Ghi chú" },
      { name: "created_by", label: "Người tạo" }
    ]
  },
  {
    entity: "CustomerClaimRequest",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: [
      { name: "customer_id", label: "Khách hàng" },
      { name: "sale_id", label: "Sale yêu cầu nhận" },
      { name: "phone_number", label: "Số điện thoại" },
      { name: "note", label: "Ghi chú" },
      { name: "status", label: "Trạng thái" },
      { name: "revoke_reason", label: "Lý do thu hồi" },
      { name: "resolved_by", label: "Người duyệt" },
      { name: "resolved_at", label: "Thời điểm duyệt" },
      { name: "reject_reason", label: "Lý do từ chối" }
    ]
  },
  {
    entity: "CustomerInteraction",
    subjectAttributes: [
      { path: "subject.userId", label: "ID nhân viên (chính mình)", type: "reference" }
    ],
    resourceAttributes: [
      { path: "resource.sale_id", label: "Sale phụ trách tương tác", type: "reference" }
    ],
    fields: [
      { name: "type", label: "Loại tương tác" },
      { name: "content", label: "Nội dung" },
      { name: "result", label: "Kết quả" },
      { name: "next_action.description", label: "Hành động tiếp theo" },
      { name: "next_action.due_date", label: "Hạn xử lý tiếp theo" },
      { name: "sale_id", label: "Sale phụ trách" },
      { name: "agent_id", label: "Đại lý liên quan" }
    ]
  },
  {
    entity: "CallLog",
    subjectAttributes: [
      { path: "subject.userId", label: "ID nhân viên (chính mình)", type: "reference" },
      {
        path: "subject.departmentColleagueUserIds",
        label: "Danh sách user cùng phòng ban",
        type: "reference"
      }
    ],
    resourceAttributes: [
      { path: "resource.sale_id", label: "Sale xử lý cuộc gọi", type: "reference" }
    ],
    fields: [
      { name: "direction", label: "Hướng gọi" },
      { name: "phone_number", label: "Số điện thoại khách hàng" },
      { name: "hotline", label: "Hotline" },
      { name: "sip_user", label: "Máy lẻ nhân viên" },
      { name: "sale_id", label: "Sale xử lý cuộc gọi" },
      { name: "customer_id", label: "Khách hàng" },
      { name: "answer_sec", label: "Số giây trả lời" },
      { name: "bill_sec", label: "Số giây tính tiền" },
      { name: "duration", label: "Thời lượng" },
      { name: "call_out_price", label: "Cước cuộc gọi" },
      { name: "time_start_call", label: "Thời gian bắt đầu" },
      { name: "time_end_call", label: "Thời gian kết thúc" },
      { name: "hangup_cause", label: "Hình thức kết thúc" },
      { name: "recording_file_url", label: "File ghi âm" },
      { name: "record_seconds", label: "Số giây ghi âm" },
      { name: "note", label: "Ghi chú" },
      { name: "tag", label: "Tags" }
    ]
  },
  {
    entity: "SaleOmicallProfile",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: []
  },
  {
    entity: "Transaction",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: []
  },
  {
    entity: "DashboardMetric",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: []
  },
  {
    entity: "AiChat",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: []
  },
  {
    entity: "AppIntegration",
    subjectAttributes: [],
    resourceAttributes: [],
    fields: []
  }
];

async function seed(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log("✅ Kết nối MongoDB thành công");

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const def of DEFINITIONS) {
    const existing = await EntityAttributeCatalogModel.findOne({ entity: def.entity });

    if (!existing) {
      await EntityAttributeCatalogModel.create(def);
      console.log(`✅ Tạo entity_attribute_catalog: ${def.entity}`);
      created++;
      continue;
    }

    const payload = {
      subjectAttributes: def.subjectAttributes,
      resourceAttributes: def.resourceAttributes,
      fields: def.fields,
      isDeleted: false
    };
    const existingPlain = existing.toObject();
    const isSame =
      !existing.isDeleted &&
      isEqual(existingPlain.subjectAttributes, def.subjectAttributes) &&
      isEqual(existingPlain.resourceAttributes, def.resourceAttributes) &&
      isEqual(existingPlain.fields, def.fields);

    if (isSame) {
      console.log(`⏭  Bỏ qua (đã đúng): ${def.entity}`);
      skipped++;
      continue;
    }

    await EntityAttributeCatalogModel.updateOne({ _id: existing._id }, { $set: payload });
    console.log(`♻️  Cập nhật entity_attribute_catalog: ${def.entity}`);
    updated++;
  }

  console.log(`\n🎉 Hoàn thành: tạo mới ${created}, cập nhật ${updated}, bỏ qua ${skipped}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
