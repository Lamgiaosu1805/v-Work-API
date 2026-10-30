import { TicketActor, TicketProps } from "./types";

// Quy tắc ai được xem/làm gì trên một ticket (thuần domain). Bảng quy tắc: docs/TICKET-MODULE-PLAN.md
// mục 6.1. Quyền "chung" (ticket.view, ticket.handle...) do CASL kiểm tra ở route; ở đây chỉ là quan hệ
// của người thao tác với TỪNG ticket cụ thể.

export type TicketAccessLevel = "full" | "summary" | "none";

type AccessProps = Pick<TicketProps, "status" | "visibility" | "createdBy" | "assignment">;

function sameId(a: unknown, b: unknown): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
}

function isFinished(status: TicketProps["status"]): boolean {
  return status === "closed" || status === "cancelled";
}

export function isRequester(ticket: Pick<TicketProps, "createdBy">, actor: TicketActor): boolean {
  return sameId(ticket.createdBy, actor.employeeId);
}

// Thuộc nhóm xử lý đang có: chủ trì hoặc người phối hợp.
export function isHandler(ticket: Pick<TicketProps, "assignment">, actor: TicketActor): boolean {
  const { ownerId, collaboratorIds } = ticket.assignment;
  return (
    sameId(ownerId, actor.employeeId) || collaboratorIds.some((id) => sameId(id, actor.employeeId))
  );
}

// Liên quan tới ticket: người tạo, nhóm xử lý, hoặc người được giao đích danh khi ticket CHƯA có chủ trì.
// Có chủ trì rồi thì quyền xem thuộc về nhóm xử lý hiện tại — người từng được giao nhưng đã bị gỡ / đã trả lại
// không còn thấy ticket hạn chế và file nhạy cảm (mục 6.1).
export function isInvolved(ticket: AccessProps, actor: TicketActor): boolean {
  return (
    isRequester(ticket, actor) ||
    isHandler(ticket, actor) ||
    (!ticket.assignment.ownerId &&
      ticket.assignment.memberIds.some((id) => sameId(id, actor.employeeId)))
  );
}

// Được thao tác như nhóm xử lý (đổi trạng thái, kết luận...): thành viên nhóm hoặc người có ticket.manage.
export function canActAsHandler(
  ticket: Pick<TicketProps, "assignment">,
  actor: TicketActor
): boolean {
  return actor.canManage || isHandler(ticket, actor);
}

// Có được nhận ticket "open" chưa có chủ trì không: ticket không giao thì ai cũng nhận; giao đích danh thì
// chỉ người trong danh sách; giao phòng ban thì thành viên phòng đó (kể cả người ở phòng con).
export function isEligibleToClaim(
  assignment: TicketProps["assignment"],
  employeeId: string,
  departmentIds: string[]
): boolean {
  if (assignment.mode === "none") return true;
  if (assignment.mode === "members") {
    return assignment.memberIds.some((id) => sameId(id, employeeId));
  }
  return departmentIds.some((id) => sameId(id, assignment.departmentId));
}

// Thành viên phòng ban được giao (kể cả phòng con) khi ticket còn chờ nhận: họ nhận được ticket nên phải
// thấy được nó, kể cả ticket hạn chế. Sau khi đã có chủ trì thì quyền xem thuộc về nhóm xử lý.
export function isDepartmentCandidate(
  ticket: Pick<TicketProps, "assignment">,
  actor: TicketActor
): boolean {
  const { mode, departmentId, ownerId } = ticket.assignment;
  return (
    mode === "department" && !ownerId && actor.departmentIds.some((id) => sameId(id, departmentId))
  );
}

// Khách hàng của ticket: mã khách (externalId = userId trên app / CMS, cũng là khoá mở hồ sơ khách trong CRM) chỉ
// trả cho người cần dùng nó.
//   - showExternalId: HIỂN THỊ mã trên giao diện — IT (xem ticket hạn chế / file nhạy cảm), người quản lý ticket
//     và nhóm xử lý (chủ trì, phối hợp).
//   - includeExternalId: có trả mã trong dữ liệu — nhóm trên cộng người có quyền xem khách hàng (để bấm sang hồ
//     sơ khách trong CRM; họ vốn đã thấy mã này ở CRM).
export function customerVisibility(
  ticket: Pick<TicketProps, "assignment">,
  actor: TicketActor
): { showExternalId: boolean; includeExternalId: boolean } {
  const privileged =
    actor.canViewRestricted ||
    actor.canViewSensitive ||
    actor.canManage ||
    isHandler(ticket, actor);
  return {
    showExternalId: privileged,
    includeExternalId: privileged || Boolean(actor.canViewCustomer)
  };
}

// Ticket do người cùng phòng (kể cả phòng con) tạo — nhân viên thường xem được ticket thường của họ.
export function isCreatedByColleague(
  ticket: Pick<TicketProps, "createdBy">,
  actor: TicketActor
): boolean {
  return actor.colleagueIds.some((id) => sameId(id, ticket.createdBy));
}

export function accessLevel(ticket: AccessProps, actor: TicketActor): TicketAccessLevel {
  if (actor.canViewRestricted) return "full";
  if (ticket.visibility === "normal") {
    // Ticket thường: người xử lý / quản lý xem hết; nhân viên thường chỉ ticket của mình, người cùng phòng, hoặc
    // ticket mình là người liên quan (được giao, phối hợp).
    const inScope =
      actor.canViewAll ||
      isInvolved(ticket, actor) ||
      isDepartmentCandidate(ticket, actor) ||
      isCreatedByColleague(ticket, actor);
    return inScope ? "full" : "none";
  }
  if (!isInvolved(ticket, actor) && !isDepartmentCandidate(ticket, actor)) return "none";
  // Ticket hạn chế đã kết thúc: người liên quan chỉ còn thấy thông tin chung (mã, tiêu đề, trạng
  // thái, kết quả, ghi chú kết luận) — đủ để biết kết quả và mở lại trong hạn.
  return isFinished(ticket.status) ? "summary" : "full";
}

// File nhạy cảm (CCCD, chứng từ, tờ trình): người có quyền xem luôn xem được; người liên quan chỉ khi
// ticket chưa kết thúc. Người khác chỉ thấy dòng thông tin file, không mở được (mục 6.2).
export function canViewSensitiveFiles(ticket: AccessProps, actor: TicketActor): boolean {
  if (actor.canViewSensitive) return true;
  return isInvolved(ticket, actor) && !isFinished(ticket.status);
}
