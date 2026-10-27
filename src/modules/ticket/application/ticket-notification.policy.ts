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
  TicketStatusChangedDomainEvent,
  TicketUrgencyRaisedDomainEvent
} from "../domain/events/ticket.domain-events";
import { RESOLUTION_LABELS, URGENCY_LABELS } from "../domain/ticket-catalog";
import { TICKET_ESCALATED_URGENCIES, TicketProps } from "../domain/types";

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
  // Người phụ trách nhận ticket mới (cộng dồn mẫu + loại + sản phẩm; Khẩn và Cao thêm cả mặc định), đã tra sẵn —
  // xem ticket-responsible.ts.
  responsibleIds: string[];
  // Trưởng phòng được giao khi giao cho phòng ban, đã tra sẵn.
  departmentManagerId: string | null;
  // Thành viên (kể cả phòng con) của phòng được giao — chỉ tra khi phòng chưa có người quản lý.
  departmentMemberIds?: string[];
  // Tên nơi ticket được giao ("Nguyễn A, Trần B" hoặc tên phòng) để ghi cho người tạo biết.
  assignmentTargetLabel?: string;
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

// Người tự làm hành động không nhận thông báo của chính mình. Một người chỉ nhận một thông báo cho mỗi sự
// kiện: thông báo đứng trước được ưu tiên.
function finalize(planned: PlannedNotification[], actorId: string | null): PlannedNotification[] {
  const alreadyNotified = new Set<string>();
  return planned
    .map((item) => {
      const employeeIds = [...new Set(item.employeeIds)].filter(
        (id) => (!actorId || id !== actorId) && !alreadyNotified.has(id)
      );
      employeeIds.forEach((id) => alreadyNotified.add(id));
      return { ...item, employeeIds };
    })
    .filter((item) => item.employeeIds.length > 0);
}

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

// Giao việc (lúc tạo hoặc giao lại):
//   - Giao người cụ thể → tất cả người được giao.
//   - Giao phòng ban → trưởng phòng; phòng chưa có người quản lý và ticket chưa ai nhận → cả phòng; ticket đã có
//     người nhận → thêm chủ trì + người phối hợp.
//   - Giao lại → người cũ bị gỡ ra khỏi nhóm xử lý cũng được báo.
//   - Người tạo luôn được báo ticket đã được giao cho ai.
function planAssignment(
  event: TicketAssignedDomainEvent,
  context: PolicyContext,
  label: string
): PlannedNotification[] {
  const { props } = context.ticket;
  const owner = props.assignment.ownerId;
  const handlers = owner ? [owner, ...props.assignment.collaboratorIds] : [];

  let assignees: string[];
  if (event.mode === "members") {
    assignees = event.memberIds;
  } else {
    const manager = context.departmentManagerId;
    // Đã có người nhận → chủ trì + phối hợp; chưa ai nhận mà phòng không có quản lý → cả phòng
    let others: string[] = [];
    if (owner) others = handlers;
    else if (!manager) others = context.departmentMemberIds ?? [];
    assignees = [...(manager ? [manager] : []), ...others];
  }

  const removed = event.previousHandlerIds.filter((id) => !assignees.includes(id));
  const target = context.assignmentTargetLabel
    ? `
Giao cho: ${context.assignmentTargetLabel}`
    : "";
  return [
    event.mode === "members"
      ? plan("assigned", assignees, "Bạn được giao một ticket", label)
      : plan("assigned_department", assignees, "Phòng bạn được giao một ticket", label),
    plan(
      "unassigned",
      removed,
      "Bạn không còn xử lý ticket này",
      `${label}
Ticket đã được giao lại cho người khác.`
    ),
    plan(
      "assigned_requester",
      [props.createdBy],
      "Ticket của bạn đã được giao xử lý",
      `${label}${target}`
    )
  ];
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
    // Ticket mới → người phụ trách (Khẩn / Cao: thêm cả danh sách mặc định; thường/thấp: chỉ người phụ trách
    // cụ thể của mẫu/loại/sản phẩm). Ticket đang chờ người tạo bổ sung tờ trình thì chưa báo — sẽ báo khi
    // người tạo bổ sung xong (TicketInfoSubmittedDomainEvent).
    if (props.status !== "waiting_info") {
      planned = TICKET_ESCALATED_URGENCIES.includes(event.urgency)
        ? [
            plan(
              `${event.urgency}_created`,
              context.responsibleIds,
              `Ticket mức ${URGENCY_LABELS[event.urgency]} mới`,
              label
            )
          ]
        : [plan("created", context.responsibleIds, "Có ticket mới thuộc phụ trách của bạn", label)];
    }
  } else if (event instanceof TicketUrgencyRaisedDomainEvent) {
    // Ticket chưa ai nhận bị nâng lên Khẩn / Cao → báo lại người phụ trách (gồm danh sách mặc định). Nâng lên
    // mức thường thì không báo: mức đó vốn không báo danh sách mặc định.
    if (TICKET_ESCALATED_URGENCIES.includes(event.to)) {
      planned = [
        plan(
          "urgency_raised",
          context.responsibleIds,
          `Ticket được nâng lên mức ${URGENCY_LABELS[event.to]}`,
          `${label}\nTừ mức ${URGENCY_LABELS[event.from]} lên ${URGENCY_LABELS[event.to]}, chưa có người nhận`
        )
      ];
    }
  } else if (event instanceof TicketAssignedDomainEvent) {
    planned = planAssignment(event, context, label);
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
    // Đã có chủ trì → báo chủ trì VÀ người phối hợp (chủ trì vắng thì cả nhóm vẫn biết). Chưa ai nhận (vd
    // ticket vừa đủ tờ trình, quay về "open") → báo người phụ trách để ticket không bị bỏ sót.
    planned = owner
      ? [
          plan(
            "info_submitted",
            [owner, ...props.assignment.collaboratorIds],
            "Người tạo đã bổ sung thông tin",
            label
          )
        ]
      : [
          plan(
            "info_submitted_unclaimed",
            context.responsibleIds,
            "Ticket đã đủ thông tin, chờ nhận",
            label
          )
        ];
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

  const actorId = (event as unknown as { actorId?: string | null }).actorId ?? null;
  return finalize(planned, actorId);
}

const SNIPPET_LENGTH = 140;

export interface MessageNotificationContext {
  ticket: PolicyTicket;
  authorId: string;
  authorName: string;
  // Nội dung đã trim; rỗng khi chỉ gửi file
  body: string;
  mentionIds: string[];
  // Người phụ trách (xem ticket-responsible.ts) — chỉ dùng khi ticket chưa có chủ trì
  responsibleIds: string[];
  // Trưởng phòng khi ticket giao cho phòng ban — chỉ dùng khi ticket chưa có chủ trì
  departmentManagerId: string | null;
}

// Tin nhắn mới trong phần trao đổi:
//   - Người được @nhắc tên: "Bạn được nhắc tên trong ticket …" (đứng trước nên thay cho thông báo chung).
//   - Người tạo ticket, chủ trì và người phối hợp: "Có trao đổi mới trong ticket …".
//   - Ticket chưa có chủ trì: thay cho chủ trì là những người đang chờ nhận (người được giao đích danh, hoặc
//     trưởng phòng được giao) và người phụ trách (7.1); ticket đang chờ người tạo bổ sung (waiting_info) chưa
//     báo người phụ trách, giống lúc tạo ticket.
//   - Người gửi không tự nhận; mỗi người chỉ nhận một thông báo cho mỗi tin nhắn.
// Ticket hạn chế: không đính kèm nội dung tin nhắn (người nhận có thể chưa có quyền xem).
export function planMessageNotifications(
  context: MessageNotificationContext,
  restricted: boolean
): PlannedNotification[] {
  const { props } = context.ticket;
  const owner = props.assignment.ownerId;

  let handlers: Array<string | null> = [];
  if (owner) {
    handlers = [owner, ...props.assignment.collaboratorIds];
  } else {
    handlers = [
      ...(props.assignment.mode === "members" ? props.assignment.memberIds : []),
      ...(props.assignment.mode === "department" ? [context.departmentManagerId] : []),
      ...(props.status === "waiting_info" ? [] : context.responsibleIds)
    ];
  }

  const snippet = restricted ? "" : context.body.slice(0, SNIPPET_LENGTH);
  let messageBody = `${context.authorName} đã gửi file đính kèm`;
  if (restricted) messageBody = `${context.authorName} đã gửi tin nhắn mới`;
  else if (snippet) messageBody = `${context.authorName}: ${snippet}`;

  return finalize(
    [
      plan("mention", context.mentionIds, `Bạn được nhắc tên trong ticket ${props.code}`, snippet),
      plan(
        "message",
        [props.createdBy, ...handlers],
        `Có trao đổi mới trong ticket ${props.code}`,
        messageBody
      )
    ],
    context.authorId
  );
}
