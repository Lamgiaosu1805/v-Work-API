import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";
import { RequestType } from "../types";

export interface RequestApprovedDomainEventProps extends DomainEventProps {
  userId: string;
  reviewerId: string;
  requestType: RequestType;
}

export class RequestApprovedDomainEvent extends DomainEvent {
  readonly userId: string;

  readonly reviewerId: string;

  readonly requestType: RequestType;

  constructor(props: RequestApprovedDomainEventProps) {
    super(props);
    this.userId = props.userId;
    this.reviewerId = props.reviewerId;
    this.requestType = props.requestType;
  }
}
