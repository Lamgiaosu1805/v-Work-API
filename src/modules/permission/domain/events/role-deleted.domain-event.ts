import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";

export interface RoleDeletedDomainEventProps extends DomainEventProps {
  roleCode: string;
  affectedEmployeeIds: string[];
}

export class RoleDeletedDomainEvent extends DomainEvent {
  readonly roleCode: string;

  readonly affectedEmployeeIds: string[];

  constructor(props: RoleDeletedDomainEventProps) {
    super(props);
    this.roleCode = props.roleCode;
    this.affectedEmployeeIds = props.affectedEmployeeIds;
  }
}
