import { ValueObject } from "../../../../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../../../../core/exceptions/exceptions";

export interface PermissionGrantProps {
  permissionCode: string;
  dataScopePolicyCode: string;
  fieldScopePolicyCode?: string | null;
}

export class PermissionGrant extends ValueObject<PermissionGrantProps> {
  static of(props: PermissionGrantProps): PermissionGrant {
    return new PermissionGrant(props);
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ permissionCode, dataScopePolicyCode }: PermissionGrantProps): void {
    if (!permissionCode || typeof permissionCode !== "string") {
      throw new ArgumentInvalidException("PermissionGrant thiếu permissionCode hợp lệ");
    }
    if (!dataScopePolicyCode || typeof dataScopePolicyCode !== "string") {
      throw new ArgumentInvalidException(
        `PermissionGrant "${permissionCode}" thiếu dataScopePolicyCode hợp lệ`
      );
    }
  }

  get permissionCode(): string {
    return this.unpack().permissionCode;
  }

  get dataScopePolicyCode(): string {
    return this.unpack().dataScopePolicyCode;
  }

  get fieldScopePolicyCode(): string | null {
    return this.unpack().fieldScopePolicyCode ?? null;
  }

  withFieldScopePolicy(fieldScopePolicyCode: string | null): PermissionGrant {
    return PermissionGrant.of({ ...this.unpack(), fieldScopePolicyCode });
  }
}
