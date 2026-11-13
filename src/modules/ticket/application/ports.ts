import { ClientSession } from "mongoose";

// Cổng (port) tầng application gọi ra ngoài module: dữ liệu tổ chức (nhân viên/phòng ban) và thông báo.
// Cài đặt ở infrastructure/ — module ticket không import module khác (luật #1 trong CLAUDE.md).

export interface EmployeeSummary {
  id: string;
  fullName: string;
  accountId: string | null;
  departmentNames: string[];
}

export interface DepartmentSummary {
  id: string;
  name: string;
  managerId: string | null;
}

export interface TicketDirectory {
  resolveEmployeeId(accountId: string): Promise<string>;
  // Phòng ban của nhân viên + toàn bộ phòng cha (người ở phòng con thuộc phòng cha).
  getDepartmentIdsWithAncestors(employeeId: string): Promise<string[]>;
  // Mọi nhân viên thuộc phòng mình quản lý/làm việc, kể cả phòng con — phạm vi trưởng bộ phận được giao việc.
  getOwnDepartmentTreeEmployeeIds(employeeId: string): Promise<string[]>;
  // Nhân viên đang làm việc của một phòng ban, kể cả các phòng con — để báo khi ticket giao cho phòng mà phòng chưa có người quản lý.
  getDepartmentMemberIds(departmentId: string): Promise<string[]>;
  // Trong danh sách nhân viên, những ai có quyền `action` của ticket (vd "ticket.handle") — kiểm tra người KHÁC người đang thao tác.
  // `action` là mảng thì chỉ cần có MỘT trong các quyền.
  filterEmployeesWithPermission(
    employeeIds: string[],
    action: string | string[]
  ): Promise<string[]>;
  getEmployees(ids: string[]): Promise<EmployeeSummary[]>;
  getDepartments(ids: string[]): Promise<DepartmentSummary[]>;
  // `onlyIds`: chỉ tìm trong tập người này (lọc ở câu truy vấn, trước khi cắt `limit`)
  searchEmployees(query: string, limit: number, onlyIds?: string[]): Promise<EmployeeSummary[]>;
  listDepartments(): Promise<DepartmentSummary[]>;
}

// Hồ sơ khách CRM mà ticket gắn vào (chỉ định danh, không kèm dữ liệu khách).
export interface CrmCustomerRef {
  customerId: string;
  externalId: string | null;
  appCode: string;
}

// Tra hồ sơ khách CRM theo SĐT trong một app — chạy phía server cho người tạo không có quyền xem khách (không tự tra
// được qua API khách hàng). Kết quả chỉ dùng để gắn ticket, không bao giờ trả cho người tạo.
export interface TicketCustomerResolver {
  // Chỉ trả khi khớp ĐÚNG MỘT hồ sơ; không khớp / mơ hồ → null.
  findByPhone(phone: string, appCode: string): Promise<CrmCustomerRef | null>;
}

export interface TicketNotification {
  employeeIds: string[];
  title: string;
  body?: string;
  type: string;
  ticketId: string;
  push?: boolean;
  // true = ném lỗi khi KHÔNG gửi được cho người nào (mặc định nuốt lỗi từng người). Cron dùng để biết có nên đánh dấu
  // "đã nhắc" hay không.
  strict?: boolean;
}

export interface TicketNotifier {
  notify(notification: TicketNotification): Promise<void>;
}

// Báo cho người đang mở trang chi tiết ticket (qua socket) rằng ticket vừa đổi. CHỈ là tín hiệu "tải lại đi", không
// mang nội dung: dữ liệu vẫn lấy qua REST nên quyền xem / che thông tin vẫn do API chi tiết quyết định.
//   - "updated": ticket đổi (trạng thái, người xử lý, nội dung...) — có thể làm ai đó mất quyền xem.
//   - "message": chỉ có tin nhắn mới — không đổi quyền xem nên không cần kiểm tra lại quyền.
export interface TicketChange {
  ticketId: string;
  kind: "updated" | "message";
  version?: number;
  actorId: string | null;
}

export interface TicketRealtime {
  // Không chờ, không ném lỗi: tín hiệu hỏng không được làm hỏng thao tác đã lưu xong.
  publishChanged(change: TicketChange): void;
}

// Lưu nội dung ẩn (mật khẩu...) của một tin nhắn — bản cài đặt mã hoá trước khi ghi.
export interface TicketSecretStore {
  createMany(input: {
    ticketId: string;
    // null = nội dung ẩn trong ô ghi chú của thao tác, không thuộc tin nhắn nào
    messageId: string | null;
    authorId: string;
    secrets: Array<{ id: string; label: string; value: string }>;
  }): Promise<void>;
}

// Kiểm tra quyền xem MỘT ticket của người đang kết nối socket (cùng quy tắc với API chi tiết: domain/ticket-access.ts).
export interface TicketWatchAuthorizer {
  canWatch(employeeId: string, ticketId: string): Promise<boolean>;
  // Trong danh sách người đang xem, những ai KHÔNG còn mở được ticket (ticket bị giao lại, chuyển hạn chế, kết thúc...).
  lostAccess(ticketId: string, employeeIds: string[]): Promise<Set<string>>;
}

export type MaybeSession = ClientSession | undefined;
