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
  getEmployees(ids: string[]): Promise<EmployeeSummary[]>;
  getDepartments(ids: string[]): Promise<DepartmentSummary[]>;
  // `onlyIds`: chỉ tìm trong tập người này (lọc ở câu truy vấn, trước khi cắt `limit`)
  searchEmployees(query: string, limit: number, onlyIds?: string[]): Promise<EmployeeSummary[]>;
  listDepartments(): Promise<DepartmentSummary[]>;
}

export interface TicketNotification {
  employeeIds: string[];
  title: string;
  body?: string;
  type: string;
  ticketId: string;
  push?: boolean;
}

export interface TicketNotifier {
  notify(notification: TicketNotification): Promise<void>;
}

export type MaybeSession = ClientSession | undefined;
