// Cache trong bộ nhớ tiến trình, sống ngắn — để các dữ liệu hiếm đổi (danh sách phòng ban, cấu hình ticket, ánh xạ
// tài khoản → nhân viên) không phải hỏi lại DB ở MỌI request. Mỗi lượt hỏi DB là một lượt chờ nối tiếp; khi DB ở xa
// (vd chạy API local nối DB trên server) mỗi lượt tốn hàng chục ms.
//
// - Lưu cả Promise: nhiều request cùng lúc khi cache nguội chỉ gọi DB một lần.
// - Lỗi không được lưu (lần sau thử lại).
// - Khi chạy test (NODE_ENV=test) cache tắt hẳn để test thấy dữ liệu vừa ghi ngay.
// - Chỉ đúng trong MỘT tiến trình: chạy nhiều bản API thì dữ liệu có thể cũ tối đa `ttlMs` ở bản khác.

const MAX_ENTRIES = 5000;

export function cacheTtl(ms: number): number {
  return process.env.NODE_ENV === "test" ? 0 : ms;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, { promise: Promise<T>; expiresAt: number }>();

  constructor(private readonly ttl: number) {}

  getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttl <= 0) return load();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.promise;

    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    const promise = load();
    this.entries.set(key, { promise, expiresAt: Date.now() + this.ttl });
    promise.catch(() => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
    });
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}
