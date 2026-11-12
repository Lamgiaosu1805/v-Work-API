import { cacheTtl, TtlCache } from "../../src/core/cache/ttl-cache";

describe("TtlCache", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("trong thời hạn chỉ gọi nguồn một lần, quá hạn thì gọi lại", async () => {
    jest.useFakeTimers();
    const cache = new TtlCache<number>(1000);
    const load = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrLoad("k", load)).toBe(1);
    expect(await cache.getOrLoad("k", load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1001);
    expect(await cache.getOrLoad("k", load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("nhiều lần gọi cùng lúc khi cache nguội chỉ chạy nguồn một lần", async () => {
    const cache = new TtlCache<string>(1000);
    const load = jest.fn().mockResolvedValue("x");

    const results = await Promise.all([
      cache.getOrLoad("k", load),
      cache.getOrLoad("k", load),
      cache.getOrLoad("k", load)
    ]);

    expect(results).toEqual(["x", "x", "x"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("lỗi không được lưu: lần sau thử lại", async () => {
    const cache = new TtlCache<number>(1000);
    const load = jest.fn().mockRejectedValueOnce(new Error("hỏng")).mockResolvedValueOnce(7);

    await expect(cache.getOrLoad("k", load)).rejects.toThrow("hỏng");
    expect(await cache.getOrLoad("k", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("clear xoá hết; khoá khác nhau tách biệt", async () => {
    const cache = new TtlCache<string>(1000);
    const a = jest.fn().mockResolvedValue("a");
    const b = jest.fn().mockResolvedValue("b");
    await cache.getOrLoad("a", a);
    await cache.getOrLoad("b", b);

    cache.clear();
    await cache.getOrLoad("a", a);

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("thời hạn 0 (và khi chạy test) tắt cache", async () => {
    const cache = new TtlCache<number>(0);
    const load = jest.fn().mockResolvedValue(1);
    await cache.getOrLoad("k", load);
    await cache.getOrLoad("k", load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(cacheTtl(60_000)).toBe(0); // jest đặt NODE_ENV=test
  });
});
