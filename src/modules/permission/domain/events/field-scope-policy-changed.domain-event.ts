import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";

export interface FieldScopePolicyChangedDomainEventProps extends DomainEventProps {
  policyCode: string;
}

export class FieldScopePolicyChangedDomainEvent extends DomainEvent {
  readonly policyCode: string;

  constructor(props: FieldScopePolicyChangedDomainEventProps) {
    super(props);
    this.policyCode = props.policyCode;
  }
}
