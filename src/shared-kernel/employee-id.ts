import { ValueObject, DomainPrimitive } from "../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";

export class EmployeeId extends ValueObject<DomainPrimitive<string>> {
  static of(value: unknown): EmployeeId {
    if (value === null || value === undefined) {
      throw new ArgumentInvalidException("EmployeeId không được null/undefined");
    }
    return new EmployeeId({ value: String(value) });
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ value }: DomainPrimitive<string>): void {
    if (!value || typeof value !== "string") {
      throw new ArgumentInvalidException("EmployeeId phải là chuỗi khác rỗng");
    }
  }

  toString(): string {
    return this.unpack();
  }
}
