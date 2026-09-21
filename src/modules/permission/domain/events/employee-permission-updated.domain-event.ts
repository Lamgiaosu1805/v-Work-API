import { DomainEvent, DomainEventProps } from "../../../../core/ddd/domain-event.base";

export interface EmployeePermissionUpdatedDomainEventProps extends DomainEventProps {
  employeeId: string;
}

export class EmployeePermissionUpdatedDomainEvent extends DomainEvent {
  readonly employeeId: string;

  constructor(props: EmployeePermissionUpdatedDomainEventProps) {
    super(props);
    this.employeeId = props.employeeId;
  }
}
