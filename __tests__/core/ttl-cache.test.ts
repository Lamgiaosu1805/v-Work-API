import {
  cacheTtl,
  DIRECTORY_CACHE_GROUP,
  invalidateCacheGroup,
  invalidateDirectoryCaches,
  TtlCache
} from "../../src/core/cache/ttl-cache";

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

  it("invalidateCacheGroup chỉ xoá các cache cùng nhóm", async () => {
    const inGroupA = new TtlCache<string>(1000, "nhom-a");
    const inGroupA2 = new TtlCache<string>(1000, "nhom-a");
    const inGroupB = new TtlCache<string>(1000, "nhom-b");
    const noGroup = new TtlCache<string>(1000);
    const loads = [inGroupA, inGroupA2, inGroupB, noGroup].map((cache) => {
      const load = jest.fn().mockResolvedValue("x");
      return { cache, load };
    });
    await Promise.all(loads.map(({ cache, load }) => cache.getOrLoad("k", load)));

    invalidateCacheGroup("nhom-a");
    await Promise.all(loads.map(({ cache, load }) => cache.getOrLoad("k", load)));

    expect(loads.map(({ load }) => load.mock.calls.length)).toEqual([2, 2, 1, 1]);
  });

  it("invalidateDirectoryCaches xoá cache nhóm danh bạ, không đụng nhóm khác", async () => {
    const directory = new TtlCache<string>(1000, DIRECTORY_CACHE_GROUP);
    const other = new TtlCache<string>(1000, "khac");
    const loadDirectory = jest.fn().mockResolvedValue("d");
    const loadOther = jest.fn().mockResolvedValue("o");
    await directory.getOrLoad("k", loadDirectory);
    await other.getOrLoad("k", loadOther);

    invalidateDirectoryCaches();
    await directory.getOrLoad("k", loadDirectory);
    await other.getOrLoad("k", loadOther);

    expect(loadDirectory).toHaveBeenCalledTimes(2);
    expect(loadOther).toHaveBeenCalledTimes(1);
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
