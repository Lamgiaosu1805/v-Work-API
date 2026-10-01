import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";

export interface FecLeadCompletedDomainEventProps extends DomainEventProps {
  leadGenId: string;
  customerId: string;
}

export class FecLeadCompletedDomainEvent extends DomainEvent {
  readonly leadGenId: string;

  readonly customerId: string;

  constructor(props: FecLeadCompletedDomainEventProps) {
    super(props);
    this.leadGenId = props.leadGenId;
    this.customerId = props.customerId;
  }
}
