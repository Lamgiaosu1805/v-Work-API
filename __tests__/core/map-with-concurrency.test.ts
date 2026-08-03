import { mapWithConcurrency } from "../../src/core/async/map-with-concurrency";

describe("mapWithConcurrency()", () => {
  it("giữ đúng thứ tự kết quả theo index input, không theo thứ tự hoàn thành", async () => {
    const items = [30, 10, 20];
    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
      return ms;
    });

    expect(results).toEqual([30, 10, 20]);
  });

  it("giới hạn đúng số tác vụ chạy đồng thời (concurrency cap)", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (i) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      active -= 1;
      return i;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("concurrency lớn hơn số item vẫn chạy đúng, không lỗi", async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (i) => i * 2);
    expect(results).toEqual([2, 4]);
  });

  it("mảng rỗng -> trả mảng rỗng, không treo", async () => {
    const results = await mapWithConcurrency([], 5, async (i) => i);
    expect(results).toEqual([]);
  });

  it("worker throw -> Promise.all reject đúng lỗi, không nuốt lỗi im lặng", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (i) => {
        if (i === 2) throw new Error("boom");
        return i;
      })
    ).rejects.toThrow("boom");
  });
});
