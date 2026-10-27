import { TICKET_ESCALATED_URGENCIES, TicketUrgency } from "../domain/types";

// Ai là "người phụ trách" nhận thông báo khi ticket mới sẵn sàng để nhận (thuần, không đọc DB).
// Thiết kế: docs/TICKET-MODULE-PLAN.md mục 7.1.
//
// CỘNG DỒN: người của Mẫu yêu cầu + Loại yêu cầu + Sản phẩm cùng nhận (không còn "cấp cụ thể thay mặc định").
//   - Ticket Khẩn và Cao: thêm cả danh sách mặc định (cài đặt chung).
//   - Ticket Bình thường / Thấp: chỉ người phụ trách CỤ THỂ (mẫu, loại, sản phẩm) — danh sách mặc định không
//     bị báo mọi ticket thường.

export interface ResponsibleSources {
  templateIds?: string[];
  categoryIds?: string[];
  productIds?: string[];
  defaultIds?: string[];
}

export function resolveResponsibleIds(
  urgency: TicketUrgency,
  sources: ResponsibleSources
): string[] {
  const specific = [
    ...(sources.templateIds ?? []),
    ...(sources.categoryIds ?? []),
    ...(sources.productIds ?? [])
  ];
  const all = TICKET_ESCALATED_URGENCIES.includes(urgency)
    ? [...specific, ...(sources.defaultIds ?? [])]
    : specific;
  return [...new Set(all.map(String))];
}
