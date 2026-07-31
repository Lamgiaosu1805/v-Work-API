/* eslint-disable max-classes-per-file --
   Test file: two trivial Value Object fixtures, not production code. */
const { ValueObject } = require("../../src/core/ddd/value-object.base");
const { ArgumentNotProvidedException } = require("../../src/core/exceptions/exceptions");

class Money extends ValueObject {
  // eslint-disable-next-line class-methods-use-this
  validate(props) {
    if (typeof props.value !== "number" || props.value < 0) {
      throw new Error("Money must be a non-negative number");
    }
  }
}

class Address extends ValueObject {
  // eslint-disable-next-line class-methods-use-this
  validate(props) {
    if (!props.city) throw new Error("city required");
  }
}

describe("ValueObject", () => {
  it("cannot be instantiated directly (abstract)", () => {
    expect(() => new ValueObject({ x: 1 })).toThrow(/must be implemented/);
  });

  it("throws ArgumentNotProvidedException for null/undefined/empty-object props", () => {
    expect(() => new Address(null)).toThrow(ArgumentNotProvidedException);
    expect(() => new Address(undefined)).toThrow(ArgumentNotProvidedException);
    expect(() => new Address({})).toThrow(ArgumentNotProvidedException);
  });

  it("throws ArgumentNotProvidedException for an empty domain primitive value", () => {
    expect(() => new Money({ value: null })).toThrow(ArgumentNotProvidedException);
    expect(() => new Money({ value: "" })).toThrow(ArgumentNotProvidedException);
  });

  it("runs the subclass validate() and surfaces its error", () => {
    expect(() => new Money({ value: -1 })).toThrow(/non-negative/);
  });

  describe("unpack()", () => {
    it("returns the raw value for a single-primitive VO", () => {
      const m = new Money({ value: 100 });
      expect(m.unpack()).toBe(100);
    });

    it("returns a frozen shallow copy for a multi-field VO", () => {
      const a = new Address({ city: "Hanoi", street: "X" });
      const unpacked = a.unpack();
      expect(unpacked).toEqual({ city: "Hanoi", street: "X" });
      expect(() => {
        unpacked.city = "HCM";
      }).not.toThrow();
      expect(unpacked.city).toBe("Hanoi");
    });
  });

  describe("equals()", () => {
    it("returns true for the same primitive value", () => {
      expect(new Money({ value: 100 }).equals(new Money({ value: 100 }))).toBe(true);
    });

    it("returns false for different primitive values", () => {
      expect(new Money({ value: 100 }).equals(new Money({ value: 200 }))).toBe(false);
    });

    it("returns false when compared to null/undefined", () => {
      expect(new Money({ value: 100 }).equals(null)).toBe(false);
      expect(new Money({ value: 100 }).equals(undefined)).toBe(false);
    });

    it("REGRESSION: is independent of object key insertion order (not JSON.stringify-based)", () => {
      const a = new Address({ city: "Hanoi", street: "X" });
      const b = new Address({ street: "X", city: "Hanoi" });
      expect(a.equals(b)).toBe(true);
    });

    it("returns false when field values differ even with same keys", () => {
      const a = new Address({ city: "Hanoi", street: "X" });
      const c = new Address({ city: "HCM", street: "X" });
      expect(a.equals(c)).toBe(false);
    });
  });
});
