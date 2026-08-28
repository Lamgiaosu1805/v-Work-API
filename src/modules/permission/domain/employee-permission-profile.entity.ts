import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { OverrideStatus, OverrideStatusValue } from "./value-objects/override-status.vo";
import { EmployeePermissionUpdatedDomainEvent } from "./events/employee-permission-updated.domain-event";

export interface PermissionOverrideProps {
  permissionCode: string;
  status: OverrideStatusValue;
  dataScopePolicyCode?: string | null;
  fieldScopePolicyCode?: string | null;
}

export interface EmployeePermissionProfileProps {
  employeeId: string;
  roleIds: string[];
  overrides: PermissionOverrideProps[];
}

export interface CreateEmployeePermissionProfileInput {
  id: string;
  employeeId: string;
}

export class EmployeePermissionProfileEntity extends AggregateRoot<EmployeePermissionProfileProps> {
  static create({
    id,
    employeeId
  }: CreateEmployeePermissionProfileInput): EmployeePermissionProfileEntity {
    return new EmployeePermissionProfileEntity({
      id,
      props: { employeeId, roleIds: [], overrides: [] }
    });
  }

  get employeeId(): string {
    return this.props.employeeId;
  }

  get roleIds(): string[] {
    return [...this.props.roleIds];
  }

  get overrides(): PermissionOverrideProps[] {
    return [...this.props.overrides];
  }

  assignRole(roleId: string): void {
    if (this.props.roleIds.includes(roleId)) return;
    this._setProps({ roleIds: [...this.props.roleIds, roleId] });
    this._raiseUpdated();
  }

  unassignRole(roleId: string): void {
    if (!this.props.roleIds.includes(roleId)) return;
    this._setProps({ roleIds: this.props.roleIds.filter((id) => id !== roleId) });
    this._raiseUpdated();
  }

  setOverride(
    permissionCode: string,
    status: string,
    dataScopePolicyCode?: string | null,
    fieldScopePolicyCode?: string | null
  ): void {
    const validated = OverrideStatus.of(status);
    const withoutExisting = this.props.overrides.filter(
      (override) => override.permissionCode !== permissionCode
    );
    this._setProps({
      overrides: [
        ...withoutExisting,
        {
          permissionCode,
          status: validated.toString(),
          dataScopePolicyCode: dataScopePolicyCode ?? null,
          fieldScopePolicyCode: fieldScopePolicyCode ?? null
        }
      ]
    });
    this._raiseUpdated();
  }

  clearOverride(permissionCode: string): void {
    const exists = this.props.overrides.some(
      (override) => override.permissionCode === permissionCode
    );
    if (!exists) return;
    this._setProps({
      overrides: this.props.overrides.filter(
        (override) => override.permissionCode !== permissionCode
      )
    });
    this._raiseUpdated();
  }

  removeRoleReference(roleId: string): void {
    this._setProps({ roleIds: this.props.roleIds.filter((id) => id !== roleId) });
  }

  private _raiseUpdated(): void {
    this.addEvent(
      new EmployeePermissionUpdatedDomainEvent({
        aggregateId: this.id,
        employeeId: this.props.employeeId
      })
    );
  }

  validate(): void {
    if (!this.props.employeeId || typeof this.props.employeeId !== "string") {
      throw new ArgumentInvalidException("EmployeePermissionProfile thiếu employeeId hợp lệ");
    }
  }
}
