import isEqual from "lodash/isEqual";
import { ArgumentNotProvidedException } from "../exceptions/exceptions";

export interface DomainPrimitive<T> {
  value: T;
}

function isDomainPrimitive<T>(candidate: unknown): candidate is DomainPrimitive<T> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    Object.prototype.hasOwnProperty.call(candidate, "value")
  );
}

function isEmpty(props: unknown): boolean {
  if (props === null || props === undefined) return true;
  if (isDomainPrimitive(props)) {
    return props.value === null || props.value === undefined || props.value === "";
  }
  return typeof props === "object" && Object.keys(props as object).length === 0;
}

export abstract class ValueObject<Props> {
  protected readonly props: Props;

  constructor(props: Props) {
    if (isEmpty(props)) {
      throw new ArgumentNotProvidedException("ValueObject props should not be empty.");
    }
    this.validate(props);
    this.props = props;
  }

  static isValueObject(candidate: unknown): candidate is ValueObject<unknown> {
    return candidate instanceof ValueObject;
  }

  equals(other?: unknown): boolean {
    if (other === null || other === undefined) return false;
    if (!ValueObject.isValueObject(other)) return false;
    return isEqual(this.props, other.props);
  }

  unpack(): Props extends DomainPrimitive<infer T> ? T : Readonly<Props> {
    if (isDomainPrimitive<unknown>(this.props)) {
      return this.props.value as Props extends DomainPrimitive<infer T> ? T : Readonly<Props>;
    }
    return Object.freeze({ ...this.props }) as Props extends DomainPrimitive<infer T>
      ? T
      : Readonly<Props>;
  }

  // eslint-disable-next-line class-methods-use-this
  validate(_props: Props): void {
    throw new Error("ValueObject.validate() must be implemented by a subclass.");
  }
}
