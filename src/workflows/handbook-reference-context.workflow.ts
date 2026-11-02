import { logger } from "../config/logger";
import type { ReferenceContextProvider } from "../modules/handbook-assistant";
import { getTicketGuideText } from "../modules/ticket";

// Cài đặt cổng ReferenceContextProvider của Trợ lý Nội quy bằng module `ticket`: cho trợ lý biết cấu hình ticket
// ĐANG ÁP DỤNG (ngưỡng "Cần chú ý", tự đóng / mở lại, lịch làm việc, sản phẩm, mẫu yêu cầu) để trả lời bằng số
// liệu thật của môi trường thay vì số ghi cứng trong docs/HUONG-DAN-TICKET.md. Sống ở workflows/ vì cần nối 2
// module (handbook-assistant + ticket) mà module không được import lẫn nhau.
//
// Cấu hình ít đổi nên giữ bản đã đọc trong `cacheMs` (mặc định 60 giây) thay vì đọc DB ở mỗi câu hỏi; đổi ở màn
// Cấu hình thì tối đa sau chừng đó trợ lý dùng số mới. Lỗi đọc không ném ra ngoài: trả `ticketConfig: null` để trợ
// lý nói "chưa tra được lúc này" thay vì đoán, và lần sau đọc lại.
export function createHandbookReferenceContext(
  loadTicketText: () => Promise<string> = getTicketGuideText,
  cacheMs = 60_000,
  now: () => number = Date.now
): ReferenceContextProvider {
  let cached: { text: string; at: number } | null = null;
  let pending: Promise<string> | null = null;

  return {
    async getCurrent() {
      if (cached && now() - cached.at < cacheMs) return { ticketConfig: cached.text };
      try {
        // Nhiều câu hỏi cùng lúc khi cache hết hạn chỉ đọc DB một lần.
        pending ??= loadTicketText().finally(() => {
          pending = null;
        });
        const text = await pending;
        cached = { text, at: now() };
        return { ticketConfig: text };
      } catch (error) {
        logger.warn("Trợ lý Nội quy: không đọc được cấu hình ticket", {
          error: error instanceof Error ? error.message : String(error)
        });
        return { ticketConfig: null };
      }
    }
  };
}
