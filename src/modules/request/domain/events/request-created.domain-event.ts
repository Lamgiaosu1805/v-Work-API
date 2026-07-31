import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";
import { RequestType } from "../types";

export interface RequestCreatedDomainEventProps extends DomainEventProps {
  userId: string;
  requestType: RequestType;
}

export class RequestCreatedDomainEvent extends DomainEvent {
  readonly userId: string;

  readonly requestType: RequestType;

  constructor(props: RequestCreatedDomainEventProps) {
    super(props);
    this.userId = props.userId;
    this.requestType = props.requestType;
  }
}
