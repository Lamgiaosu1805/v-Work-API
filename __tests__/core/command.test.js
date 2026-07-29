const { Command } = require("../../src/core/ddd/command.base");
const { RequestContextService } = require("../../src/core/context/request-context");
const { ArgumentNotProvidedException } = require("../../src/core/exceptions/exceptions");

class TestCommand extends Command {
  constructor(props) {
    super(props);
    this.userId = props.userId;
  }
}

describe("Command", () => {
  it("throws ArgumentNotProvidedException when props is null/undefined", () => {
    expect(() => new TestCommand(null)).toThrow(ArgumentNotProvidedException);
    expect(() => new TestCommand(undefined)).toThrow(ArgumentNotProvidedException);
  });

  it("auto-generates a unique id when not provided", () => {
    const c1 = new TestCommand({ userId: "u-1" });
    const c2 = new TestCommand({ userId: "u-1" });
    expect(typeof c1.id).toBe("string");
    expect(c1.id).not.toBe(c2.id);
  });

  it("respects an explicitly provided id (idempotency key use case)", () => {
    const c = new TestCommand({ userId: "u-1", id: "fixed-id" });
    expect(c.id).toBe("fixed-id");
  });

  it("propagates subclass fields", () => {
    const c = new TestCommand({ userId: "u-1" });
    expect(c.userId).toBe("u-1");
  });

  it("correlationId is undefined outside a request context, auto-fills inside one", () => {
    const outside = new TestCommand({ userId: "u-1" });
    expect(outside.metadata.correlationId).toBeUndefined();

    RequestContextService.run({ requestId: "req-xyz" }, () => {
      const inside = new TestCommand({ userId: "u-1" });
      expect(inside.metadata.correlationId).toBe("req-xyz");
    });
  });

  it("an explicit correlationId wins over the ambient context", () => {
    RequestContextService.run({ requestId: "req-xyz" }, () => {
      const c = new TestCommand({ userId: "u-1", metadata: { correlationId: "manual" } });
      expect(c.metadata.correlationId).toBe("manual");
    });
  });
});
