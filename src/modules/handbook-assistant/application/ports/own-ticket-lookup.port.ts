import type { PersonalAsker } from "./personal-context.port";

// Cổng tra MỘT ticket cụ thể để trợ lý trả lời "ticket TK-... của tôi đang thế nào". Module này không được import module
// khác (luật workflows/) nên dữ liệu đến từ bên ngoài qua cổng này — tầng workflows/ cài đặt
// (src/workflows/handbook-own-ticket-lookup.workflow.ts), index.js nối vào socket.
//
// BẢO MẬT — chỉ ticket do CHÍNH người hỏi tạo:
//  - cổng chỉ nhận danh tính LẤY TỪ SOCKET ĐÃ XÁC THỰC; mã ticket (do người dùng gõ) chỉ dùng để chọn trong số ticket CỦA
//    HỌ, không bao giờ quyết định ai được xem;
//  - ticket của người khác, ticket không tồn tại và ticket đã xoá đều trả về như nhau (nằm trong `notFoundCodes`) nên
//    không dò được một mã có tồn tại hay không;
//  - nội dung ticket do module ticket dựng sẵn thành các dòng chữ (đã bỏ mô tả, thông tin khách, trao đổi, tên file).

export interface OwnTicketBrief {
  code: string;
  // Mỗi dòng một thông tin, đã là chữ tiếng Việt hoàn chỉnh.
  lines: string[];
}

export interface OwnTicketsLookup {
  briefs: OwnTicketBrief[];
  notFoundCodes: string[];
}

export interface OwnTicketLookupProvider {
  lookup(asker: PersonalAsker, codes: string[]): Promise<OwnTicketsLookup>;
}

// Kết quả đưa vào prompt: tra được (có thể có mã không tìm thấy) hoặc không tra được lúc này (lỗi / quá hạn).
export type OwnTicketsContext =
  | ({ status: "ok" } & OwnTicketsLookup)
  | { status: "unavailable"; codes: string[] };
