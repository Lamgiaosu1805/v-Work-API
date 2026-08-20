import { ValueObject, DomainPrimitive } from "../../../../core/ddd/value-object.base";
import { InvalidRoleCodeFormatError } from "../permission.errors";

const ROLE_CODE_PATTERN = /^[A-Z0-9_]+$/;
const MAX_LENGTH = 50;

export class RoleCode extends ValueObject<DomainPrimitive<string>> {
  static of(value: string): RoleCode {
    return new RoleCode({ value });
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ value }: DomainPrimitive<string>): void {
    if (typeof value !== "string" || !ROLE_CODE_PATTERN.test(value) || value.length > MAX_LENGTH) {
      throw new InvalidRoleCodeFormatError(
        `Mã vai trò không hợp lệ: "${value}" — chỉ được chứa chữ cái viết hoa (A-Z), số (0-9), dấu gạch dưới (_), tối đa ${MAX_LENGTH} ký tự`
      );
    }
  }

  toString(): string {
    return this.unpack();
  }
}
