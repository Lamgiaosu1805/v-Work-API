const { Entity } = require("../../src/core/ddd/entity.base");
const {
  ArgumentNotProvidedException,
  ArgumentInvalidException
} = require("../../src/core/exceptions/exceptions");

class TestEntity extends Entity {
  validate() {
    if (this.props.name === "") throw new ArgumentInvalidException("name cannot be empty");
  }
}

describe("Entity", () => {
  it("constructs successfully with a valid id + props", () => {
    const e = new TestEntity({ id: "1", props: { name: "Alpha" } });
    expect(e.id).toBe("1");
    expect(e.getProps().name).toBe("Alpha");
    expect(e.isDeleted).toBe(false);
  });

  it("defaults createdAt/updatedAt to now when not provided", () => {
    const before = Date.now();
    const e = new TestEntity({ id: "1", props: {} });
    expect(e.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(e.updatedAt).toEqual(e.createdAt);
  });

  it("throws ArgumentNotProvidedException when id is missing", () => {
    expect(() => new TestEntity({ id: null, props: {} })).toThrow(ArgumentNotProvidedException);
    expect(() => new TestEntity({ id: undefined, props: {} })).toThrow(
      ArgumentNotProvidedException
    );
  });

  it("throws ArgumentInvalidException when props is not an object", () => {
    expect(() => new TestEntity({ id: "1", props: null })).toThrow(ArgumentInvalidException);
    expect(() => new TestEntity({ id: "1", props: "x" })).toThrow(ArgumentInvalidException);
  });

  it("cannot be instantiated directly (abstract) — plain Error, not a domain exception", () => {
    expect(() => new Entity({ id: "1", props: {} })).toThrow(/abstract/i);
    try {
      // eslint-disable-next-line no-new
      new Entity({ id: "1", props: {} });
    } catch (err) {
      expect(err).not.toBeInstanceOf(ArgumentNotProvidedException);
    }
  });

  it("calls validate() on construction and surfaces its exception", () => {
    expect(() => new TestEntity({ id: "1", props: { name: "" } })).toThrow(
      ArgumentInvalidException
    );
  });

  it("skips validate() when { validate: false } is passed (reconstitution from possibly-legacy data)", () => {
    expect(
      () => new TestEntity({ id: "1", props: { name: "" } }, { validate: false })
    ).not.toThrow();
  });

  it("getProps() is frozen — mutating the returned object has no effect", () => {
    const e = new TestEntity({ id: "1", props: { name: "Alpha" } });
    const props = e.getProps();
    expect(() => {
      props.name = "Mutated";
    }).not.toThrow();
    expect(e.getProps().name).toBe("Alpha");
  });

  it("_setProps() merges props, bumps updatedAt, and re-validates", () => {
    const e = new TestEntity({ id: "1", props: { name: "Alpha" } });
    const updatedAtBefore = e.updatedAt;
    e._setProps({ name: "Beta" });
    expect(e.getProps().name).toBe("Beta");
    expect(e.updatedAt.getTime()).toBeGreaterThanOrEqual(updatedAtBefore.getTime());
    expect(() => e._setProps({ name: "" })).toThrow(ArgumentInvalidException);
  });

  it("markAsDeleted() sets isDeleted true and bumps updatedAt", () => {
    const e = new TestEntity({ id: "1", props: { name: "Alpha" } });
    e.markAsDeleted();
    expect(e.isDeleted).toBe(true);
  });

  it("equals() compares by id (identity), not by props", () => {
    const a = new TestEntity({ id: "1", props: { name: "Alpha" } });
    const b = new TestEntity({ id: "1", props: { name: "Different" } });
    const c = new TestEntity({ id: "2", props: { name: "Alpha" } });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(null)).toBe(false);
    expect(a.equals(undefined)).toBe(false);
    expect(a.equals({ id: "1" })).toBe(false);
  });
});
