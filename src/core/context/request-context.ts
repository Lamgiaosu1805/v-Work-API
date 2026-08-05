import { AsyncLocalStorage } from "async_hooks";

export interface Store {
  requestId?: string;
  transactionSession?: unknown;
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<Store>();

export class RequestContextService {
  static run<T>(store: Store, callback: () => T): T {
    if (storage.getStore()) {
      throw new Error(
        "RequestContextService.run() called while already inside a context — " +
          "use runChild() to extend the current context instead of replacing it."
      );
    }
    return storage.run(store, callback);
  }

  static runChild<T>(partialStore: Partial<Store>, callback: () => T): T {
    const parentStore = storage.getStore() ?? {};
    return storage.run({ ...parentStore, ...partialStore }, callback);
  }

  static getContext(): Store {
    const store = storage.getStore();
    if (!store) {
      throw new Error(
        "No request context found — make sure this code runs inside RequestContextService.run()."
      );
    }
    return store;
  }

  static getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  }

  static setRequestId(requestId: string): void {
    this.getContext().requestId = requestId;
  }

  static getTransactionSession(): unknown {
    return storage.getStore()?.transactionSession;
  }

  static setTransactionSession(session: unknown): void {
    this.getContext().transactionSession = session;
  }

  static clearTransactionSession(): void {
    this.getContext().transactionSession = undefined;
  }
}
