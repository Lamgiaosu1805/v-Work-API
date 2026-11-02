// Cổng lấy dữ liệu tra cứu DÙNG CHUNG (không phải của riêng ai) từ các module khác của vWork, để trợ lý trả lời
// bằng số liệu đang áp dụng thật thay vì số ghi cứng trong văn bản hướng dẫn. Hiện có: cấu hình Ticket hỗ trợ
// (ngưỡng "Cần chú ý", tự đóng / mở lại, lịch làm việc, sản phẩm, mẫu yêu cầu) cho docs/HUONG-DAN-TICKET.md.
// Module này không được import module khác (luật workflows/) nên tầng workflows/ cài đặt
// (src/workflows/handbook-reference-context.workflow.ts), index.js nối vào socket.
//
// Dữ liệu ở đây đặt trong phần prompt được cache dùng chung cả công ty, nên phải TẤT ĐỊNH (cùng dữ liệu → cùng
// từng byte) và tuyệt đối không chứa dữ liệu cá nhân của ai (cái đó đi qua PersonalContextProvider).

export interface ReferenceContext {
  // Văn bản cấu hình ticket đang áp dụng; null = không tra được lúc này (lỗi hệ thống).
  ticketConfig: string | null;
}

export interface ReferenceContextProvider {
  getCurrent(): Promise<ReferenceContext>;
}
