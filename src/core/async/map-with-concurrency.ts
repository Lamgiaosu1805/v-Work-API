// Worker-pool bounded-concurrency map — dùng khi cần chạy N tác vụ async (thường là round-trip DB)
// song song có giới hạn, thay vì tuần tự từng cái (chậm do cộng dồn latency round-trip) hoặc
// Promise.all không giới hạn (có thể tràn connection pool khi N lớn).
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, runWorker));

  return results;
}
