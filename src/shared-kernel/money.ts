import { ValueObject, DomainPrimitive } from "../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";

const PRECISION = 100;

function roundToSafePrecision(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

export class Money extends ValueObject<DomainPrimitive<number>> {
  static of(value: number): Money {
    return new Money({ value: roundToSafePrecision(value) });
  }

  static zero(): Money {
    return Money.of(0);
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ value }: DomainPrimitive<number>): void {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new ArgumentInvalidException(`Money không hợp lệ: ${value}`);
    }
  }

  toNumber(): number {
    return this.unpack();
  }

  isNegative(): boolean {
    return this.unpack() < 0;
  }

  add(other: Money): Money {
    return Money.of(this.unpack() + other.unpack());
  }

  subtract(other: Money): Money {
    return Money.of(this.unpack() - other.unpack());
  }
}
