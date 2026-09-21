import { AggregateRoot } from "../../../core/ddd/aggregate-root.base";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { RoleCode } from "./value-objects/role-code.vo";
import { PermissionGrant, PermissionGrantProps } from "./value-objects/permission-grant.vo";
import { SystemRoleNotDeletableError } from "./permission.errors";
import { RoleDeletedDomainEvent } from "./events/role-deleted.domain-event";

export interface RoleProps {
  name: string;
  code: string;
  description: string;
  isSystemRole: boolean;
  grants: PermissionGrantProps[];
}

export interface CreateRoleInput {
  id: string;
  name: string;
  code: string;
  description?: string;
  isSystemRole?: boolean;
}

export class RoleEntity extends AggregateRoot<RoleProps> {
  static create({
    id,
    name,
    code,
    description = "",
    isSystemRole = false
  }: CreateRoleInput): RoleEntity {
    return new RoleEntity({
      id,
      props: { name: name.trim(), code, description, isSystemRole, grants: [] }
    });
  }

  get name(): string {
    return this.props.name;
  }

  get code(): string {
    return this.props.code;
  }

  get description(): string {
    return this.props.description;
  }

  get isSystemRole(): boolean {
    return this.props.isSystemRole;
  }

  get grants(): PermissionGrant[] {
    return this.props.grants.map((grant) => PermissionGrant.of(grant));
  }

  rename(name: string, description?: string): void {
    this._setProps({ name: name.trim(), ...(description !== undefined ? { description } : {}) });
  }

  addGrant(grant: PermissionGrantProps): void {
    const validated = PermissionGrant.of(grant);
    const withoutExisting = this.props.grants.filter(
      (existing) => existing.permissionCode !== validated.permissionCode
    );
    this._setProps({ grants: [...withoutExisting, validated.unpack()] });
  }

  removeGrant(permissionCode: string): void {
    this._setProps({
      grants: this.props.grants.filter((grant) => grant.permissionCode !== permissionCode)
    });
  }

  assertDeletable(): void {
    if (this.props.isSystemRole) {
      throw new SystemRoleNotDeletableError(undefined, {
        metadata: { roleId: this.id, roleCode: this.props.code }
      });
    }
  }

  markDeleted(affectedEmployeeIds: string[]): void {
    this.assertDeletable();
    this.markAsDeleted();
    this.addEvent(
      new RoleDeletedDomainEvent({
        aggregateId: this.id,
        roleCode: this.props.code,
        affectedEmployeeIds
      })
    );
  }

  validate(): void {
    if (!this.props.name || typeof this.props.name !== "string") {
      throw new ArgumentInvalidException("Tên vai trò không được để trống");
    }
    if (this.props.name.length > 100) {
      throw new ArgumentInvalidException("Tên vai trò không được vượt quá 100 ký tự");
    }
    RoleCode.of(this.props.code);
  }
}
