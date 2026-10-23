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

// Liên quan tới ticket: người tạo, nhóm xử lý, hoặc người được giao đích danh (chưa nhận).
export function isInvolved(ticket: AccessProps, actor: TicketActor): boolean {
  return (
    isRequester(ticket, actor) ||
    isHandler(ticket, actor) ||
    ticket.assignment.memberIds.some((id) => sameId(id, actor.employeeId))
  );
}

// Được thao tác như nhóm xử lý (đổi trạng thái, kết luận...): thành viên nhóm hoặc người có ticket.manage.
export function canActAsHandler(ticket: Pick<TicketProps, "assignment">, actor: TicketActor): boolean {
  return actor.canManage || isHandler(ticket, actor);
}

export function accessLevel(ticket: AccessProps, actor: TicketActor): TicketAccessLevel {
  if (ticket.visibility === "normal") return "full";
  if (actor.canViewRestricted) return "full";
  if (!isInvolved(ticket, actor)) return "none";
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
