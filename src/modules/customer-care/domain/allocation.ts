// Chọn Sale nhận khách từ Pool — bản giai đoạn 1 của Điều 5–6: chia đều (round-robin) cho Sale đủ
// điều kiện, có giới hạn năng lực/ngày. Kênh 50/40/10 theo hiệu suất làm ở giai đoạn 2.

export interface SaleCandidate {
  saleId: string;
  capNewPerDay: number;
  capTotal: number;
  /** Số khách mới đã nhận hôm nay (giờ VN) */
  newToday: number;
  /** Số khách đang phải xử lý (lượt giao còn hiệu lực) */
  activeLoad: number;
  lastAssignedAt: Date | null;
}

/** Trạng thái "Đủ" (Điều 6.2b): đã chạm hạn mức khách mới/ngày hoặc tổng khách đang xử lý. */
export function isSaleFull(candidate: SaleCandidate): boolean {
  return candidate.newToday >= candidate.capNewPerDay || candidate.activeLoad >= candidate.capTotal;
}

/** Số khách còn được nhận thêm hôm nay (Phụ lục 01-B). */
export function remainingCapacity(candidate: SaleCandidate): number {
  return Math.max(
    0,
    Math.min(candidate.capNewPerDay - candidate.newToday, candidate.capTotal - candidate.activeLoad)
  );
}

/**
 * Round-robin: Sale lâu nhất chưa được giao khách đứng đầu (chưa từng giao = ưu tiên nhất), hoà thì
 * ít khách đang xử lý hơn, cuối cùng theo saleId cho kết quả ổn định. Bỏ qua Sale đã từng giữ khách.
 */
export function pickSaleRoundRobin(
  candidates: SaleCandidate[],
  excludeSaleIds: string[] = []
): SaleCandidate | null {
  const excluded = new Set(excludeSaleIds);
  const eligible = candidates.filter((c) => !excluded.has(c.saleId) && !isSaleFull(c));
  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const aTime = a.lastAssignedAt ? a.lastAssignedAt.getTime() : -1;
    const bTime = b.lastAssignedAt ? b.lastAssignedAt.getTime() : -1;
    if (aTime !== bTime) return aTime - bTime;
    if (a.activeLoad !== b.activeLoad) return a.activeLoad - b.activeLoad;
    return a.saleId.localeCompare(b.saleId);
  });
  return eligible[0];
}
