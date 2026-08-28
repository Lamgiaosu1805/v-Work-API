import { ValueObject, DomainPrimitive } from "../../../../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../../../../core/exceptions/exceptions";

export type OverrideStatusValue = "ALLOW" | "BLOCK";

const VALID_STATUSES: OverrideStatusValue[] = ["ALLOW", "BLOCK"];

function isOverrideStatusValue(value: string): value is OverrideStatusValue {
  return (VALID_STATUSES as string[]).includes(value);
}

function assertValidOverrideStatus(value: string): asserts value is OverrideStatusValue {
  if (!isOverrideStatusValue(value)) {
    throw new ArgumentInvalidException(
      `Override status không hợp lệ: "${value}", phải là ALLOW/BLOCK`
    );
  }
}

export class OverrideStatus extends ValueObject<DomainPrimitive<OverrideStatusValue>> {
  static of(value: string): OverrideStatus {
    assertValidOverrideStatus(value);
    return new OverrideStatus({ value });
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ value }: DomainPrimitive<OverrideStatusValue>): void {
    assertValidOverrideStatus(value);
  }

  toString(): OverrideStatusValue {
    return this.unpack();
  }

  isBlock(): boolean {
    return this.unpack() === "BLOCK";
  }

  isAllow(): boolean {
    return this.unpack() === "ALLOW";
  }
}
