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

  constructor(props: TicketEventProps & { urgency: TicketUrgency }) {
    super(props);
    this.urgency = props.urgency;
  }
}

export class TicketAssignedDomainEvent extends TicketDomainEvent {
  readonly mode: AssignmentMode;

  readonly departmentId: string | null;

  readonly memberIds: string[];

  constructor(
    props: TicketEventProps & {
      mode: AssignmentMode;
      departmentId: string | null;
      memberIds: string[];
    }
  ) {
    super(props);
    this.mode = props.mode;
    this.departmentId = props.departmentId;
    this.memberIds = props.memberIds;
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
