import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";
import { RequestType } from "../types";

export interface RequestCancelledDomainEventProps extends DomainEventProps {
  userId: string;
  requestType: RequestType;
}

export class RequestCancelledDomainEvent extends DomainEvent {
  readonly userId: string;

  readonly requestType: RequestType;

  constructor(props: RequestCancelledDomainEventProps) {
    super(props);
    this.userId = props.userId;
    this.requestType = props.requestType;
  }
}
