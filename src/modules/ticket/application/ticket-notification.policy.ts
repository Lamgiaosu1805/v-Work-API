import { DomainEvent } from "../../../core/ddd/domain-event.base";
import {
  TicketApprovalVerifiedDomainEvent,
  TicketAssignedDomainEvent,
  TicketClaimedDomainEvent,
  TicketCollaboratorAddedDomainEvent,
  TicketContentEditedDomainEvent,
  TicketCreatedDomainEvent,
  TicketInfoRequestedDomainEvent,
  TicketInfoSubmittedDomainEvent,
  TicketStatusChangedDomainEvent
} from "../domain/events/ticket.domain-events";
import { RESOLUTION_LABELS } from "../domain/ticket-catalog";
import { TicketProps } from "../domain/types";

// CHÍNH SÁCH THÔNG BÁO của ticket — một nơi duy nhất: sự kiện → ai nhận. Thiết kế:
// docs/TICKET-MODULE-PLAN.md mục 7.2. Nguyên tắc: chỉ báo đúng người cần (một-một), không gửi hàng loạt;
// người tự thực hiện hành động không nhận thông báo của chính mình; cảnh báo vàng KHÔNG gửi thông báo.
// Muốn đổi ai nhận khi nào thì sửa bảng ở đây, không sửa rải rác trong service.

export interface PolicyTicket {
  id: string;
  props: Pick<
    TicketProps,
    "code" | "title" | "createdBy" | "status" | "assignment" | "infoRequest"
  >;
}

export interface PolicyContext {
  ticket: PolicyTicket;
  // Người phụ trách nhận ticket Khẩn (mẫu → loại yêu cầu → mặc định), đã tra sẵn.
  urgentHandlerIds: string[];
  // Trưởng phòng được giao khi giao cho phòng ban, đã tra sẵn.
  departmentManagerId: string | null;
}

export interface PlannedNotification {
  employeeIds: string[];
  title: string;
  body: string;
  type: string;
}

const plan = (
  type: string,
  employeeIds: Array<string | null | undefined>,
  title: string,
  body = ""
): PlannedNotification => ({
  type,
  title,
  body,
  employeeIds: employeeIds.filter((id): id is string => Boolean(id))
});

function planStatusChange(
  event: TicketStatusChangedDomainEvent,
  label: string,
  requester: string,
  owner: string | null
): PlannedNotification[] {
  const { from, to } = event;
  if (to === "resolved") {
    return [plan("resolved", [requester], "Ticket đã xử lý, vui lòng xác nhận", label)];
  }
  if (to === "closed") {
    const result = event.resolutionCode ? RESOLUTION_LABELS[event.resolutionCode] : "";
    const autoClosed = event.actorId === null;
    return [
      plan(
        autoClosed ? "auto_closed" : "closed",
        [requester],
        autoClosed ? "Ticket đã tự đóng" : "Ticket đã đóng",
        result ? `${label}\nKết quả: ${result}` : label
      )
    ];
  }
  // Mở lại (từ resolved/closed về in_progress/open) → báo chủ trì.
  if ((from === "resolved" || from === "closed") && (to === "in_progress" || to === "open")) {
    return [plan("reopened", [owner], "Ticket được mở lại", label)];
  }
  return [];
}

export function planNotifications(
  event: DomainEvent,
  context: PolicyContext
): PlannedNotification[] {
  const { props } = context.ticket;
  const label = `${props.code} · ${props.title}`;
  const owner = props.assignment.ownerId;
  const requester = props.createdBy;

  let planned: PlannedNotification[] = [];

  if (event instanceof TicketCreatedDomainEvent) {
    // Ticket Khẩn mới → người phụ trách. Ticket đang chờ người tạo bổ sung tờ trình thì chưa báo.
    if (event.urgency === "urgent" && props.status !== "waiting_info") {
      planned = [plan("urgent_created", context.urgentHandlerIds, "Ticket khẩn mới", label)];
    }
  } else if (event instanceof TicketAssignedDomainEvent) {
    planned =
      event.mode === "members"
        ? [plan("assigned", event.memberIds, "Bạn được giao một ticket", label)]
        : [
            plan(
              "assigned_department",
              [context.departmentManagerId],
              "Phòng bạn được giao một ticket",
              label
            )
          ];
  } else if (event instanceof TicketClaimedDomainEvent) {
    planned = [plan("claimed", [requester], "Ticket của bạn đã có người nhận xử lý", label)];
  } else if (event instanceof TicketCollaboratorAddedDomainEvent) {
    planned = [
      plan(
        "collaborator_added",
        [event.collaboratorId],
        "Bạn được thêm vào nhóm xử lý ticket",
        label
      )
    ];
  } else if (event instanceof TicketInfoRequestedDomainEvent) {
    const items = (props.infoRequest?.items ?? []).map((item) => item.label).join(", ");
    planned = [
      plan(
        "info_requested",
        [requester],
        "Cần bổ sung thông tin cho ticket",
        `${label}\nCòn thiếu: ${items}`
      )
    ];
  } else if (event instanceof TicketInfoSubmittedDomainEvent) {
    planned = [plan("info_submitted", [owner], "Người tạo đã bổ sung thông tin", label)];
  } else if (event instanceof TicketContentEditedDomainEvent) {
    planned = [plan("content_edited", [owner], "Người tạo đã sửa nội dung ticket", label)];
  } else if (event instanceof TicketApprovalVerifiedDomainEvent) {
    // Tờ trình hợp lệ không cần báo (người xác nhận chính là nhóm xử lý); không hợp lệ thì trả về người tạo.
    if (!event.valid) {
      planned = [plan("approval_invalid", [requester], "Tờ trình chưa hợp lệ, cần bổ sung", label)];
    }
  } else if (event instanceof TicketStatusChangedDomainEvent) {
    planned = planStatusChange(event, label, requester, owner);
  }

  // Người tự làm hành động không nhận thông báo của chính mình.
  const actorId = (event as unknown as { actorId?: string | null }).actorId ?? null;
  return planned
    .map((item) => ({
      ...item,
      employeeIds: [...new Set(item.employeeIds)].filter((id) => !actorId || id !== actorId)
    }))
    .filter((item) => item.employeeIds.length > 0);
}
