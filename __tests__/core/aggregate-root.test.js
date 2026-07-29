/* eslint-disable max-classes-per-file --
   Test file: several trivial single-purpose event classes as fixtures,
   not production code. */
const { AggregateRoot } = require("../../src/core/ddd/aggregate-root.base");

class TestAggregate extends AggregateRoot {
  // eslint-disable-next-line class-methods-use-this
  validate() {}
}

describe("AggregateRoot", () => {
  it("cannot be instantiated directly — throws before its own abstract check is even reached", () => {
    // super() must run first in a derived constructor, and Entity's
    // constructor calls this.validate() as part of super() — AggregateRoot
    // has no validate() override of its own, so `new AggregateRoot(...)`
    // hits Entity's "validate() must be implemented" error before the
    // `new.target === AggregateRoot` abstract-check in aggregate-root.base.js
    // is ever reached. Misuse is still prevented (it throws either way), but
    // the message names the wrong reason — worth knowing about, not a
    // functional bug.
    expect(() => new AggregateRoot({ id: "1", props: {} })).toThrow();
  });

  it("addEvent()/domainEvents/clearEvents() manage the buffer", () => {
    const agg = new TestAggregate({ id: "1", props: {} });
    expect(agg.domainEvents).toEqual([]);
    agg.addEvent({ constructor: { name: "Foo" } });
    agg.addEvent({ constructor: { name: "Bar" } });
    expect(agg.domainEvents).toHaveLength(2);
    agg.clearEvents();
    expect(agg.domainEvents).toHaveLength(0);
  });

  it("domainEvents getter returns a copy, not the internal array", () => {
    const agg = new TestAggregate({ id: "1", props: {} });
    agg.addEvent({ constructor: { name: "Foo" } });
    const events = agg.domainEvents;
    events.push({ constructor: { name: "Injected" } });
    expect(agg.domainEvents).toHaveLength(1);
  });

  describe("publishEvents()", () => {
    it("emits every event through the given bus and clears the buffer", async () => {
      const agg = new TestAggregate({ id: "1", props: {} });
      class FooEvent {}
      class BarEvent {}
      agg.addEvent(new FooEvent());
      agg.addEvent(new BarEvent());

      const emitted = [];
      const bus = { emitAsync: jest.fn(async (name) => emitted.push(name)) };

      await agg.publishEvents(bus);

      expect(emitted).toEqual(["FooEvent", "BarEvent"]);
      expect(agg.domainEvents).toHaveLength(0);
    });

    it("does not let one failing handler block the others (Promise.allSettled, not Promise.all)", async () => {
      const agg = new TestAggregate({ id: "1", props: {} });
      class OkEvent {}
      class FailEvent {}
      class AlsoOkEvent {}
      agg.addEvent(new OkEvent());
      agg.addEvent(new FailEvent());
      agg.addEvent(new AlsoOkEvent());

      const attempted = [];
      const bus = {
        emitAsync: jest.fn(async (name) => {
          attempted.push(name);
          if (name === "FailEvent") throw new Error("handler exploded");
        })
      };

      await expect(agg.publishEvents(bus)).rejects.toThrow(AggregateError);
      // all three must have been attempted, not just up to the failing one
      expect(attempted).toEqual(["OkEvent", "FailEvent", "AlsoOkEvent"]);
    });

    it("clears the buffer even when some events fail (no outbox — nobody retries the same instance)", async () => {
      const agg = new TestAggregate({ id: "1", props: {} });
      class FailEvent {}
      agg.addEvent(new FailEvent());
      const bus = {
        emitAsync: jest.fn(async () => {
          throw new Error("boom");
        })
      };

      await expect(agg.publishEvents(bus)).rejects.toThrow();
      expect(agg.domainEvents).toHaveLength(0);
    });

    it("AggregateError.errors contains the underlying failure reasons", async () => {
      const agg = new TestAggregate({ id: "1", props: {} });
      class FailEvent {}
      agg.addEvent(new FailEvent());
      const cause = new Error("underlying reason");
      const bus = {
        emitAsync: jest.fn(async () => {
          throw cause;
        })
      };

      try {
        await agg.publishEvents(bus);
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AggregateError);
        expect(err.errors).toEqual([cause]);
      }
    });
  });
});
