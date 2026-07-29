const { DomainEvent } = require("../../src/core/ddd/domain-event.base");
const { RequestContextService } = require("../../src/core/context/request-context");
const { ArgumentNotProvidedException } = require("../../src/core/exceptions/exceptions");

class TestEvent extends DomainEvent {
  constructor(props) {
    super(props);
    this.extra = props.extra;
  }
}

describe("DomainEvent", () => {
  it("throws ArgumentNotProvidedException when aggregateId is missing", () => {
    expect(() => new TestEvent({})).toThrow(ArgumentNotProvidedException);
    expect(() => new TestEvent({ aggregateId: null })).toThrow(ArgumentNotProvidedException);
  });

  it("assigns a unique id + propagates aggregateId and subclass fields", () => {
    const e1 = new TestEvent({ aggregateId: "agg-1", extra: "x" });
    const e2 = new TestEvent({ aggregateId: "agg-1", extra: "x" });
    expect(typeof e1.id).toBe("string");
    expect(e1.id).not.toBe(e2.id);
    expect(e1.aggregateId).toBe("agg-1");
    expect(e1.extra).toBe("x");
  });

  it("defaults metadata.timestamp to now when not provided", () => {
    const before = Date.now();
    const e = new TestEvent({ aggregateId: "agg-1" });
    expect(e.metadata.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("correlationId is undefined (not thrown) when constructed outside a request context", () => {
    const e = new TestEvent({ aggregateId: "agg-1" });
    expect(e.metadata.correlationId).toBeUndefined();
  });

  it("correlationId auto-fills from RequestContextService when inside a context", () => {
    RequestContextService.run({ requestId: "req-abc" }, () => {
      const e = new TestEvent({ aggregateId: "agg-1" });
      expect(e.metadata.correlationId).toBe("req-abc");
    });
  });

  it("an explicit correlationId wins over the ambient context", () => {
    RequestContextService.run({ requestId: "req-abc" }, () => {
      const e = new TestEvent({ aggregateId: "agg-1", metadata: { correlationId: "manual" } });
      expect(e.metadata.correlationId).toBe("manual");
    });
  });
});
