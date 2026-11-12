// Cache trong bộ nhớ tiến trình, sống ngắn — để các dữ liệu hiếm đổi (danh sách phòng ban, cấu hình ticket, ánh xạ
// tài khoản → nhân viên) không phải hỏi lại DB ở MỌI request. Mỗi lượt hỏi DB là một lượt chờ nối tiếp; khi DB ở xa
// (vd chạy API local nối DB trên server) mỗi lượt tốn hàng chục ms.
//
// - Lưu cả Promise: nhiều request cùng lúc khi cache nguội chỉ gọi DB một lần.
// - Lỗi không được lưu (lần sau thử lại).
// - Khi chạy test (NODE_ENV=test) cache tắt hẳn để test thấy dữ liệu vừa ghi ngay.
// - Xoá chủ động: cache có thể gia nhập một "nhóm"; code ghi dữ liệu gọi invalidateCacheGroup(nhóm) để các cache
//   trong nhóm được nạp lại ngay ở lần đọc kế tiếp.
// - Chỉ đúng trong MỘT tiến trình: ghi từ bản API khác, script hay sửa tay trong DB thì phải chờ hết `ttlMs`.
//   Vì vậy luôn giữ ttlMs ngắn làm lưới an toàn, dù đã có xoá chủ động.

const MAX_ENTRIES = 5000;

// Nhóm cache dữ liệu danh bạ tổ chức (phòng ban, nhân viên): xoá bằng invalidateDirectoryCaches()
export const DIRECTORY_CACHE_GROUP = "directory";

const groups = new Map<string, Set<{ clear(): void }>>();

export function cacheTtl(ms: number): number {
  return process.env.NODE_ENV === "test" ? 0 : ms;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, { promise: Promise<T>; expiresAt: number }>();

  constructor(
    private readonly ttl: number,
    group?: string
  ) {
    if (group) {
      if (!groups.has(group)) groups.set(group, new Set());
      groups.get(group)?.add(this);
    }
  }

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

// Xoá mọi cache thuộc nhóm (trong tiến trình này)
export function invalidateCacheGroup(group: string): void {
  groups.get(group)?.forEach((cache) => cache.clear());
}

// Gọi sau khi ghi phòng ban / liên kết tài khoản–nhân viên để cache danh bạ nạp lại ngay
export function invalidateDirectoryCaches(): void {
  invalidateCacheGroup(DIRECTORY_CACHE_GROUP);
}
