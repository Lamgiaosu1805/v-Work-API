// Kiểu dữ liệu của module ticket hỗ trợ nội bộ. Thiết kế đầy đủ: docs/TICKET-MODULE-PLAN.md.
//
// Mọi định danh người dùng ở đây là `user_info._id` (EmployeeId) — giống module `request` — không phải
// `account._id`; tầng thông báo tự đổi sang account khi gửi.

// [CHỜ-DUYỆT-ĐIỆN-TỬ] Khi duyệt trên vWork sẽ thêm trạng thái "pending_approval" (chờ sếp duyệt) vào đây,
// vào TicketModel.status, máy trạng thái trong ticket.entity.ts và nhãn trạng thái ở frontend.
export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_info",
  "on_hold",
  "resolved",
  "closed",
  "cancelled"
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// Trạng thái còn đang xử lý (chưa kết thúc): còn sửa/giao/đổi trạng thái được.
export const TICKET_ACTIVE_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_info",
  "on_hold",
  "resolved"
];

// 4 mức, xếp từ gấp nhất tới ít gấp nhất. Mã `urgent` hiển thị là "Khẩn", `high` là "Cao".
// Mốc xử lý tham khảo (ngày làm việc): Khẩn 1 · Cao 1–2 · Bình thường 2–5 · Thấp 5–10. Các mốc này quy đổi
// thành ngưỡng cảnh báo vàng (ticket-schedule.ts), không phải hạn cứng.
export const TICKET_URGENCIES = ["urgent", "high", "normal", "low"] as const;
export type TicketUrgency = (typeof TICKET_URGENCIES)[number];

// Mức càng gấp thì thứ hạng càng nhỏ (dùng để biết một lần đổi mức là "nâng" hay "hạ").
export const TICKET_URGENCY_RANK: Record<TicketUrgency, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3
};

// Mức mà ticket mới ngoài việc báo người phụ trách của mẫu/loại/sản phẩm còn báo cả danh sách mặc định.
export const TICKET_ESCALATED_URGENCIES: readonly TicketUrgency[] = ["urgent", "high"];

// Kết quả khi đóng — tách khỏi trạng thái để báo cáo biết ticket đóng vì lý do gì.
export const TICKET_RESOLUTIONS = [
  "solved",
  "wont_fix",
  "insufficient_basis",
  "not_a_bug",
  "duplicate",
  "requester_no_response"
] as const;
export type TicketResolutionCode = (typeof TICKET_RESOLUTIONS)[number];

// Kết quả bắt buộc ghi lý do (đóng mà không giải quyết được).
export const RESOLUTIONS_REQUIRING_NOTE: TicketResolutionCode[] = [
  "wont_fix",
  "insufficient_basis",
  "not_a_bug"
];

export type TicketVisibility = "normal" | "restricted";

export type AssignmentMode = "none" | "department" | "members";

// [CHỜ-DUYỆT-ĐIỆN-TỬ] Hiện chỉ có mode "document" (tải file tờ trình từ email). Khi làm duyệt trên
// vWork: thêm mode "electronic" + ElectronicApprovalGate + status ticket "pending_approval", xem
// docs/TICKET-MODULE-PLAN.md mục 5.2.
export type ApprovalMode = "document";

export type ApprovalStatus = "not_required" | "missing" | "submitted" | "verified" | "invalid";

export interface TicketCustomerSnapshot {
  customerId: string | null;
  appCode: string | null;
  phone: string | null;
  name: string | null;
  externalId: string | null;
}

export interface TicketAssignment {
  mode: AssignmentMode;
  departmentId: string | null;
  memberIds: string[];
  assignedBy: string | null;
  ownerId: string | null;
  collaboratorIds: string[];
  claimedAt: Date | null;
}

export interface TicketResolution {
  code: TicketResolutionCode;
  note: string;
  actionTaken: string;
  by: string | null;
  at: Date;
}

export interface TicketFollowUp {
  note: string;
  checkAt: Date | null;
}

export interface TicketHold {
  reason: string;
  resumeAt: Date | null;
}

export interface InfoRequestItem {
  key: string;
  label: string;
  note: string;
  fulfilled: boolean;
}

export interface TicketInfoRequest {
  items: InfoRequestItem[];
  note: string;
  requestedBy: string | null;
  requestedAt: Date;
}

export interface TicketApprovalReference {
  number: string;
  date: Date | null;
  signer: string;
}

export interface TicketApproval {
  required: boolean;
  source: "template" | "handler" | null;
  mode: ApprovalMode;
  status: ApprovalStatus;
  reference: TicketApprovalReference | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  note: string;
}

export interface TicketProps {
  code: string;
  title: string;
  description: string;
  productId: string;
  categoryId: string;
  templateId: string | null;
  customFields: Record<string, unknown>;
  urgency: TicketUrgency;
  customer: TicketCustomerSnapshot | null;
  // Nhân sự nội bộ được hỗ trợ (sản phẩm nội bộ) — sản phẩm app thì dùng `customer`.
  relatedEmployeeId: string | null;
  createdBy: string;
  assignment: TicketAssignment;
  status: TicketStatus;
  resolution: TicketResolution | null;
  followUp: TicketFollowUp | null;
  hold: TicketHold | null;
  infoRequest: TicketInfoRequest | null;
  approval: TicketApproval;
  visibility: TicketVisibility;
  relatedTicketIds: string[];
  duplicateOf: string | null;
  // Ngày dự kiến xong do nhóm xử lý tự đặt (tín hiệu "quá ngày hẹn" của cảnh báo vàng).
  dueHintAt: Date | null;
  rescheduleCount: number;
  lastActivityAt: Date;
  // Lúc ticket vào trạng thái hiện tại — mốc tính "chưa ai nhận" và tự đóng.
  statusChangedAt: Date;
  // Thời điểm ticket sẽ bị bôi vàng; null = không có hạn cảnh báo (đang chờ người tạo / đã kết thúc).
  alertAt: Date | null;
  alertReason: AlertReason | null;
  // Thời điểm hệ thống tự đóng (resolved / waiting_info không phản hồi).
  autoCloseAt: Date | null;
  // Mốc nhắc 1 lần trước khi tự đóng / tới ngày kiểm tra "cần theo dõi thêm"; reminderSentAt đặt khi đã
  // nhắc, và được xoá mỗi khi đổi trạng thái.
  remindAt: Date | null;
  reminderSentAt: Date | null;
  confirmedByRequester: boolean;
  closedAt: Date | null;
  // Hết hạn mở lại sau khi đóng (null = không mở lại được nữa).
  reopenUntil: Date | null;
  reopenCount: number;
  // Optimistic concurrency: mọi lệnh ghi phải đúng version đã đọc (xem TicketRepository.save).
  version: number;
}

export type AlertReason = "unclaimed" | "silent" | "overdue" | "hold_unknown";

// Người thao tác, đã được tầng application dựng từ quyền (CASL) + dữ liệu tổ chức.
export interface TicketActor {
  employeeId: string;
  // Phòng ban của người thao tác (kể cả phòng cha: người ở phòng con thuộc phòng cha — xem
  // TicketDirectory.resolveActor).
  departmentIds: string[];
  canAssignDepartment: boolean;
  canAssignMember: boolean;
  canManage: boolean;
  canViewRestricted: boolean;
  canViewSensitive: boolean;
  // Có quyền xem khách hàng trong CRM (customer.view) — được nhận mã khách để mở hồ sơ khách
  canViewCustomer?: boolean;
}

// Dòng nhật ký do entity sinh ra; service ghi vào ticket_activity cùng transaction.
export interface TicketActivityDraft {
  action: string;
  actorId: string | null;
  from?: string | null;
  to?: string | null;
  changes?: Array<{ field: string; from: unknown; to: unknown }>;
  note?: string;
}
