import { TicketActor } from "../domain/types";
import { TicketDirectory } from "./ports";

// Tối thiểu của CASL Ability mà module cần — module ticket không import module permission.
export interface AbilityLike {
  can(action: string, subject: string): boolean;
}

export const TICKET_SUBJECT = "Ticket";

// Dựng "người thao tác" cho domain từ tài khoản đăng nhập + bộ quyền CASL đã nạp ở requirePermission.
export async function buildTicketActor(
  directory: TicketDirectory,
  accountId: string,
  ability?: AbilityLike
): Promise<TicketActor> {
  const employeeId = await directory.resolveEmployeeId(accountId);
  const can = (action: string) => Boolean(ability?.can(action, TICKET_SUBJECT));
  return {
    employeeId,
    departmentIds: await directory.getDepartmentIdsWithAncestors(employeeId),
    canAssignDepartment: can("ticket.assign_department"),
    canAssignMember: can("ticket.assign_member"),
    canManage: can("ticket.manage"),
    canViewRestricted: can("ticket.view_restricted"),
    canViewSensitive: can("ticket.view_sensitive")
  };
}
