import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";

export interface RoleGrantsChangedDomainEventProps extends DomainEventProps {
  roleId: string;
}

export class RoleGrantsChangedDomainEvent extends DomainEvent {
  readonly roleId: string;

  constructor(props: RoleGrantsChangedDomainEventProps) {
    super(props);
    this.roleId = props.roleId;
  }
}
