import { canActAsHandler, isEligibleToClaim, isHandler, isRequester } from "./ticket-access";
import { TicketActor, TicketProps } from "./types";

// Người thao tác ĐANG LÀM ĐƯỢC gì trên ticket này — server quyết định, frontend chỉ việc hiện/ẩn nút.
// Phải khớp với các điều kiện trong ticket.entity.ts; thao tác thật vẫn được kiểm tra lại ở entity.

export interface TicketCapabilities {
  claim: boolean;
  release: boolean;
  assign: boolean;
  manageCollaborators: boolean;
  edit: boolean;
  requestInfo: boolean;
  submitInfo: boolean;
  verifyApproval: boolean;
  hold: boolean;
  resume: boolean;
  resolve: boolean;
  close: boolean;
  confirm: boolean;
  cancel: boolean;
  reopen: boolean;
  setDueHint: boolean;
  linkRelated: boolean;
  message: boolean;
}

type CapabilityProps = Pick<
  TicketProps,
  "status" | "createdBy" | "assignment" | "approval" | "confirmedByRequester" | "reopenUntil"
>;

export function capabilitiesOf(
  ticket: CapabilityProps,
  actor: TicketActor,
  now: Date = new Date()
): TicketCapabilities {
  const { status, assignment } = ticket;
  const requester = isRequester(ticket, actor);
  const handler = canActAsHandler(ticket, actor);
  const finished = status === "closed" || status === "cancelled";
  const isOwner = assignment.ownerId !== null && assignment.ownerId === actor.employeeId;

  const reopenable =
    status === "resolved" ||
    (status === "closed" &&
      !ticket.confirmedByRequester &&
      ticket.reopenUntil !== null &&
      now.getTime() <= ticket.reopenUntil.getTime());

  return {
    claim:
      status === "open" &&
      !assignment.ownerId &&
      isEligibleToClaim(assignment, actor.employeeId, actor.departmentIds),
    release: isOwner && ["in_progress", "waiting_info", "on_hold"].includes(status),
    assign:
      (actor.canAssignDepartment || actor.canAssignMember) &&
      ["open", "in_progress", "waiting_info", "on_hold"].includes(status),
    manageCollaborators: handler && !finished,
    edit:
      (requester || handler) && ["open", "in_progress", "waiting_info", "on_hold"].includes(status),
    requestInfo: handler && ["open", "in_progress", "on_hold"].includes(status),
    submitInfo: requester && status === "waiting_info",
    // [CHỜ-DUYỆT-ĐIỆN-TỬ] mode "electronic": người duyệt là người có lượt duyệt ở cấp hiện tại.
    verifyApproval:
      (handler || actor.canViewRestricted) &&
      !requester &&
      ticket.approval.required &&
      ticket.approval.status === "submitted" &&
      ["open", "in_progress", "on_hold"].includes(status),
    hold: handler && status === "in_progress",
    resume: handler && status === "on_hold",
    // Ticket cần tờ trình thì phải được xác nhận hợp lệ mới báo xong được (khớp TicketEntity.resolve)
    resolve:
      handler &&
      status === "in_progress" &&
      (!ticket.approval.required || ticket.approval.status === "verified"),
    close:
      handler && ["open", "in_progress", "waiting_info", "on_hold", "resolved"].includes(status),
    confirm: requester && status === "resolved",
    cancel: requester && ["open", "waiting_info"].includes(status),
    reopen: (requester || isHandler(ticket, actor)) && reopenable,
    setDueHint: handler && ["open", "in_progress", "on_hold"].includes(status),
    linkRelated: handler && !finished,
    message: !finished
  };
}
