import { TicketProps } from "../domain/types";
import { TicketDirectory } from "./ports";
import { TICKET_VIEW_ALL_ACTIONS } from "./ticket-actor";

// Ai trong danh sách người nhận thực sự MỞ ĐƯỢC ticket (khớp domain/ticket-access.ts accessLevel). Thông báo gửi cho
// người không mở được chỉ cho link chết (và có thể lộ tiêu đề / nội dung): người phụ trách chưa có role xem ticket
// hạn chế, người được @nhắc ở phòng khác...
//   - Người liên quan (người tạo, nhóm xử lý, người được giao đích danh) và `alsoAllowed` (trưởng / thành viên
//     phòng được giao) luôn mở được.
//   - Ticket hạn chế: người khác cần ticket.view_restricted.
//   - Ticket thường: người khác cần một quyền xem mọi ticket (xử lý / quản lý / giao phòng ban / xem hạn chế /
//     file nhạy cảm) hoặc là người cùng phòng với người tạo.
export async function recipientsWithTicketAccess(
  directory: TicketDirectory,
  props: Pick<TicketProps, "visibility" | "createdBy" | "assignment">,
  employeeIds: string[],
  alsoAllowed: Array<string | null | undefined> = []
): Promise<Set<string>> {
  const { assignment } = props;
  const involved = new Set<string>(
    [
      props.createdBy,
      assignment.ownerId,
      ...assignment.collaboratorIds,
      ...assignment.memberIds,
      ...alsoAllowed
    ]
      .filter((id): id is string => Boolean(id))
      .map(String)
  );
  const wanted = [...new Set(employeeIds.map(String))];
  const allowed = new Set(wanted.filter((id) => involved.has(id)));
  const candidates = wanted.filter((id) => !involved.has(id));
  if (!candidates.length) return allowed;

  if (props.visibility === "restricted") {
    (await directory.filterEmployeesWithPermission(candidates, "ticket.view_restricted")).forEach(
      (id) => allowed.add(id)
    );
    return allowed;
  }

  const viewAll = await directory.filterEmployeesWithPermission(
    candidates,
    TICKET_VIEW_ALL_ACTIONS
  );
  viewAll.forEach((id) => allowed.add(id));
  const rest = candidates.filter((id) => !allowed.has(id));
  if (rest.length) {
    const colleagues = new Set(
      (await directory.getOwnDepartmentTreeEmployeeIds(props.createdBy)).map(String)
    );
    rest.filter((id) => colleagues.has(id)).forEach((id) => allowed.add(id));
  }
  return allowed;
}
