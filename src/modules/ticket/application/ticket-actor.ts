import { TicketActor } from "../domain/types";
import { TicketDirectory } from "./ports";

// Tối thiểu của CASL Ability mà module cần — module ticket không import module permission.
export interface AbilityLike {
  can(action: string, subject: string): boolean;
}

export const TICKET_SUBJECT = "Ticket";

// Có MỘT trong các quyền này thì xem được mọi ticket thường của công ty (TicketActor.canViewAll).
export const TICKET_VIEW_ALL_ACTIONS = [
  "ticket.handle",
  "ticket.manage",
  "ticket.assign_department",
  "ticket.view_restricted",
  "ticket.view_sensitive"
];

// Dựng "người thao tác" cho domain từ tài khoản đăng nhập + bộ quyền CASL đã nạp ở requirePermission.
export async function buildTicketActor(
  directory: TicketDirectory,
  accountId: string,
  ability?: AbilityLike
): Promise<TicketActor> {
  const employeeId = await directory.resolveEmployeeId(accountId);
  const can = (action: string) => Boolean(ability?.can(action, TICKET_SUBJECT));
  const canAssignDepartment = can("ticket.assign_department");
  const canManage = can("ticket.manage");
  const canViewRestricted = can("ticket.view_restricted");
  const canViewSensitive = can("ticket.view_sensitive");
  // Người xử lý / quản lý cần thấy cả hàng chờ nhận của công ty; nhân viên thường chỉ thấy ticket của mình và
  // người cùng phòng (chỉ tra danh sách đồng nghiệp khi cần).
  const canViewAll = TICKET_VIEW_ALL_ACTIONS.some(can);
  return {
    employeeId,
    departmentIds: await directory.getDepartmentIdsWithAncestors(employeeId),
    canAssignDepartment,
    canAssignMember: can("ticket.assign_member"),
    canManage,
    canViewRestricted,
    canViewSensitive,
    canViewAll,
    colleagueIds: canViewAll ? [] : await directory.getOwnDepartmentTreeEmployeeIds(employeeId),
    canViewCustomer: Boolean(ability?.can("customer.view", "Customer"))
  };
}
