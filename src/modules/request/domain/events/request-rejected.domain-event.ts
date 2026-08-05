import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";
import { RequestType, Approval } from "../types";

export interface RequestRejectedDomainEventProps extends DomainEventProps {
  userId: string;
  reviewerId: string;
  requestType: RequestType;
  reviewerNote?: string;
  overriddenApprovals?: Approval[];
}

export class RequestRejectedDomainEvent extends DomainEvent {
  readonly userId: string;

  readonly reviewerId: string;

  readonly requestType: RequestType;

  readonly reviewerNote?: string;

  readonly overriddenApprovals: Approval[];

  constructor(props: RequestRejectedDomainEventProps) {
    super(props);
    this.userId = props.userId;
    this.reviewerId = props.reviewerId;
    this.requestType = props.requestType;
    this.reviewerNote = props.reviewerNote;
    this.overriddenApprovals = props.overriddenApprovals ?? [];
  }
}
