const store = new Map();

module.exports = {
  async get(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async set(key, value, ...args) {
    const nx = args.includes("NX");
    if (nx && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  },
  async setex(key, _ttlSeconds, value) {
    store.set(key, value);
    return "OK";
  },
  async del(key) {
    return store.delete(key) ? 1 : 0;
  },
  on() {},
  __store: store
};
