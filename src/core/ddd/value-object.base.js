const isEqual = require("lodash/isEqual");
const { ArgumentNotProvidedException } = require("../exceptions/exceptions");

function isDomainPrimitive(candidate) {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    Object.prototype.hasOwnProperty.call(candidate, "value")
  );
}

function isEmpty(props) {
  if (props === null || props === undefined) return true;
  if (isDomainPrimitive(props)) {
    return props.value === null || props.value === undefined || props.value === "";
  }
  return typeof props === "object" && Object.keys(props).length === 0;
}

class ValueObject {
  constructor(props) {
    if (isEmpty(props)) {
      throw new ArgumentNotProvidedException("ValueObject props should not be empty.");
    }
    this.validate(props);
    this.props = props;
  }

  static isValueObject(candidate) {
    return candidate instanceof ValueObject;
  }

  equals(other) {
    if (other === null || other === undefined) return false;
    if (!ValueObject.isValueObject(other)) return false;
    return isEqual(this.props, other.props);
  }

  unpack() {
    if (isDomainPrimitive(this.props)) {
      return this.props.value;
    }
    return Object.freeze({ ...this.props });
  }

  // eslint-disable-next-line class-methods-use-this
  validate() {
    throw new Error("ValueObject.validate() must be implemented by a subclass.");
  }
}

module.exports = { ValueObject };
