const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

class RequestContextService {
  static run(store, callback) {
    if (storage.getStore()) {
      throw new Error(
        "RequestContextService.run() called while already inside a context — " +
          "use runChild() to extend the current context instead of replacing it."
      );
    }
    return storage.run(store, callback);
  }

  static runChild(partialStore, callback) {
    const parentStore = storage.getStore() ?? {};
    return storage.run({ ...parentStore, ...partialStore }, callback);
  }

  static getContext() {
    const store = storage.getStore();
    if (!store) {
      throw new Error(
        "No request context found — make sure this code runs inside RequestContextService.run()."
      );
    }
    return store;
  }

  static getRequestId() {
    return storage.getStore()?.requestId;
  }

  static setRequestId(requestId) {
    this.getContext().requestId = requestId;
  }

  static getTransactionSession() {
    return storage.getStore()?.transactionSession;
  }

  static setTransactionSession(session) {
    this.getContext().transactionSession = session;
  }

  static clearTransactionSession() {
    this.getContext().transactionSession = undefined;
  }
}

module.exports = { RequestContextService };
