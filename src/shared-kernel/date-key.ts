import moment from "moment-timezone";
import { ValueObject, DomainPrimitive } from "../core/ddd/value-object.base";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const APP_TIMEZONE = "Asia/Ho_Chi_Minh";

export class DateKey extends ValueObject<DomainPrimitive<string>> {
  static from(date: Date | string): DateKey {
    return new DateKey({ value: moment.tz(date, APP_TIMEZONE).format("YYYY-MM-DD") });
  }

  static of(value: string): DateKey {
    return new DateKey({ value });
  }

  // eslint-disable-next-line class-methods-use-this
  validate({ value }: DomainPrimitive<string>): void {
    if (typeof value !== "string" || !DATE_KEY_REGEX.test(value)) {
      throw new ArgumentInvalidException(`DateKey không hợp lệ: "${value}", phải theo YYYY-MM-DD`);
    }
  }

  toString(): string {
    return this.unpack();
  }

  toDate(): Date {
    return moment.tz(this.unpack(), APP_TIMEZONE).startOf("day").toDate();
  }
}
