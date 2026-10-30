/* eslint-disable max-classes-per-file */
import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";
import { AssignmentMode, TicketResolutionCode, TicketStatus, TicketUrgency } from "../types";

// Mỗi sự kiện chỉ mang đủ để chính sách thông báo (application/ticket-notification.policy.ts) tìm
// người nhận; trạng thái đầy đủ của ticket được đọc lại khi xử lý.

interface TicketEventProps extends DomainEventProps {
  actorId: string | null;
}

abstract class TicketDomainEvent extends DomainEvent {
  readonly actorId: string | null;

  constructor(props: TicketEventProps) {
    super(props);
    this.actorId = props.actorId;
  }
}

export class TicketCreatedDomainEvent extends TicketDomainEvent {
  readonly urgency: TicketUrgency;

  // Ticket tạo ra đã có chủ trì (giao đích danh kèm chủ trì): không còn "chờ nhận" nên không báo "ticket mới"
  readonly ownerAtCreation: boolean;

  constructor(props: TicketEventProps & { urgency: TicketUrgency; ownerAtCreation?: boolean }) {
    super(props);
    this.urgency = props.urgency;
    this.ownerAtCreation = props.ownerAtCreation ?? false;
  }
}

// Ticket CHƯA AI NHẬN bị nâng lên mức gấp hơn (Bình thường → Cao, Cao → Khẩn...). Mang mức cũ/mới để chính sách thông báo quyết định có báo người phụ trách hay không.
export class TicketUrgencyRaisedDomainEvent extends TicketDomainEvent {
  readonly from: TicketUrgency;

  readonly to: TicketUrgency;

  constructor(props: TicketEventProps & { from: TicketUrgency; to: TicketUrgency }) {
    super(props);
    this.from = props.from;
    this.to = props.to;
  }
}

export class TicketAssignedDomainEvent extends TicketDomainEvent {
  readonly mode: AssignmentMode;

  readonly departmentId: string | null;

  readonly memberIds: string[];

  // Chủ trì + người phối hợp trước khi giao lại (rỗng khi giao lúc tạo) — để báo người bị gỡ ra
  readonly previousHandlerIds: string[];

  constructor(
    props: TicketEventProps & {
      mode: AssignmentMode;
      departmentId: string | null;
      memberIds: string[];
      previousHandlerIds?: string[];
    }
  ) {
    super(props);
    this.mode = props.mode;
    this.departmentId = props.departmentId;
    this.memberIds = props.memberIds;
    this.previousHandlerIds = props.previousHandlerIds ?? [];
  }
}

export class TicketClaimedDomainEvent extends TicketDomainEvent {}

export class TicketCollaboratorAddedDomainEvent extends TicketDomainEvent {
  readonly collaboratorId: string;

  constructor(props: TicketEventProps & { collaboratorId: string }) {
    super(props);
    this.collaboratorId = props.collaboratorId;
  }
}

export class TicketInfoRequestedDomainEvent extends TicketDomainEvent {}

export class TicketInfoSubmittedDomainEvent extends TicketDomainEvent {}

export class TicketContentEditedDomainEvent extends TicketDomainEvent {}

// Mọi lần đổi trạng thái còn lại (resolved, closed, cancelled, on_hold, mở lại, trả lại...).
export class TicketStatusChangedDomainEvent extends TicketDomainEvent {
  readonly from: TicketStatus;

  readonly to: TicketStatus;

  readonly resolutionCode: TicketResolutionCode | null;

  constructor(
    props: TicketEventProps & {
      from: TicketStatus;
      to: TicketStatus;
      resolutionCode?: TicketResolutionCode | null;
    }
  ) {
    super(props);
    this.from = props.from;
    this.to = props.to;
    this.resolutionCode = props.resolutionCode ?? null;
  }
}

export class TicketApprovalVerifiedDomainEvent extends TicketDomainEvent {
  readonly valid: boolean;

  constructor(props: TicketEventProps & { valid: boolean }) {
    super(props);
    this.valid = props.valid;
  }
}
