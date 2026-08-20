import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";

export interface DataScopePolicyChangedDomainEventProps extends DomainEventProps {
  policyCode: string;
}

export class DataScopePolicyChangedDomainEvent extends DomainEvent {
  readonly policyCode: string;

  constructor(props: DataScopePolicyChangedDomainEventProps) {
    super(props);
    this.policyCode = props.policyCode;
  }
}
