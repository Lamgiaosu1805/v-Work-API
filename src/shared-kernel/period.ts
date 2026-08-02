import { ValueObject, DomainPrimitive } from "../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";

export type PeriodValue = "morning" | "afternoon" | "full";

const VALID_PERIODS: PeriodValue[] = ["morning", "afternoon", "full"];

function isPeriodValue(value: string): value is PeriodValue {
  return (VALID_PERIODS as string[]).includes(value);
}

function assertValidPeriod(value: string): asserts value is PeriodValue {
  if (!isPeriodValue(value)) {
    throw new ArgumentInvalidException(
      `Period không hợp lệ: "${value}", phải là morning/afternoon/full`
    );
  }
}

export class Period extends ValueObject<DomainPrimitive<PeriodValue>> {
  static of(value: string): Period {
    assertValidPeriod(value);
    return new Period({ value });
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ value }: DomainPrimitive<PeriodValue>): void {
    assertValidPeriod(value);
  }

  toString(): PeriodValue {
    return this.unpack();
  }

  includesMorning(): boolean {
    return this.unpack() === "morning" || this.unpack() === "full";
  }

  includesAfternoon(): boolean {
    return this.unpack() === "afternoon" || this.unpack() === "full";
  }

  isCoveredBy(coversMorning: boolean, coversAfternoon: boolean): boolean {
    const value = this.unpack();
    if (value === "morning") return coversMorning;
    if (value === "afternoon") return coversAfternoon;
    return coversMorning && coversAfternoon;
  }
}
