const { RequestContextService } = require("../../src/core/context/request-context");

describe("RequestContextService", () => {
  describe("getContext() / getRequestId() / getTransactionSession()", () => {
    it("getContext() throws outside run()", () => {
      expect(() => RequestContextService.getContext()).toThrow(/RequestContextService\.run/);
    });

    it("getRequestId()/getTransactionSession() are safe (return undefined) outside run()", () => {
      expect(RequestContextService.getRequestId()).toBeUndefined();
      expect(RequestContextService.getTransactionSession()).toBeUndefined();
    });

    it("setRequestId()/setTransactionSession() throw outside run() (writing into a non-existent context is a real bug)", () => {
      expect(() => RequestContextService.setRequestId("x")).toThrow();
      expect(() => RequestContextService.setTransactionSession({})).toThrow();
    });
  });

  describe("run()", () => {
    it("makes requestId available for the duration of the callback", () => {
      RequestContextService.run({ requestId: "req-1" }, () => {
        expect(RequestContextService.getRequestId()).toBe("req-1");
      });
    });

    it("does not leak into code that runs after run() completes", () => {
      RequestContextService.run({ requestId: "req-1" }, () => {});
      expect(RequestContextService.getRequestId()).toBeUndefined();
    });

    it("isolates concurrent contexts from each other across async boundaries", async () => {
      const results = await Promise.all([
        RequestContextService.run({ requestId: "a" }, async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
          return RequestContextService.getRequestId();
        }),
        RequestContextService.run({ requestId: "b" }, async () => {
          return RequestContextService.getRequestId();
        })
      ]);
      expect(results).toEqual(["a", "b"]);
    });

    it("REGRESSION: throws when called nested inside an already-active context", () => {
      RequestContextService.run({ requestId: "outer" }, () => {
        expect(() => {
          RequestContextService.run({ requestId: "inner" }, () => {});
        }).toThrow(/runChild/);
        // outer context must be unaffected by the failed nested call
        expect(RequestContextService.getRequestId()).toBe("outer");
      });
    });
  });

  describe("runChild()", () => {
    it("works at top level (no parent context) just like run()", () => {
      RequestContextService.runChild({ requestId: "standalone" }, () => {
        expect(RequestContextService.getRequestId()).toBe("standalone");
      });
    });

    it("REGRESSION: inherits fields from the parent context instead of replacing it", () => {
      RequestContextService.run(
        { requestId: "outer", transactionSession: { id: "session-xyz" } },
        () => {
          RequestContextService.runChild({ jobId: "job-1" }, () => {
            expect(RequestContextService.getTransactionSession()).toEqual({ id: "session-xyz" });
            expect(RequestContextService.getRequestId()).toBe("outer");
            expect(RequestContextService.getContext().jobId).toBe("job-1");
          });
        }
      );
    });

    it("explicit fields override the inherited ones", () => {
      RequestContextService.run({ requestId: "outer", transactionSession: { id: "old" } }, () => {
        RequestContextService.runChild({ transactionSession: { id: "new" } }, () => {
          expect(RequestContextService.getTransactionSession()).toEqual({ id: "new" });
        });
      });
    });

    it("does not mutate the parent's context after it returns", () => {
      RequestContextService.run({ requestId: "outer" }, () => {
        RequestContextService.runChild({ jobId: "job-1" }, () => {});
        expect(RequestContextService.getContext().jobId).toBeUndefined();
      });
    });
  });

  describe("transaction session helpers", () => {
    it("get/set/clear work within a context", () => {
      RequestContextService.run({}, () => {
        expect(RequestContextService.getTransactionSession()).toBeUndefined();
        RequestContextService.setTransactionSession({ fake: "session" });
        expect(RequestContextService.getTransactionSession()).toEqual({ fake: "session" });
        RequestContextService.clearTransactionSession();
        expect(RequestContextService.getTransactionSession()).toBeUndefined();
      });
    });
  });
});
