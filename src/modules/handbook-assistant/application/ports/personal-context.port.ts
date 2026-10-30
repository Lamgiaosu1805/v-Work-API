// Cổng lấy thông tin CÁ NHÂN của người đang hỏi để trợ lý trả lời được những câu như "tôi còn bao nhiêu ngày phép".
// Module này không được import module khác (luật workflows/) nên dữ liệu đến từ bên ngoài qua cổng này —
// tầng workflows/ cài đặt (src/workflows/handbook-personal-context.workflow.ts), index.js nối vào socket.
//
// BẢO MẬT — chỉ ĐÚNG người hỏi:
//  - cổng chỉ nhận danh tính LẤY TỪ SOCKET ĐÃ XÁC THỰC; không có tham số nào để chỉ định nhân viên khác;
//  - danh tính không bao giờ lấy từ nội dung câu hỏi (kể cả khi câu hỏi nêu tên/mã nhân viên khác);
//  - dữ liệu của người khác không bao giờ được đưa vào prompt, nên model không thể làm lộ.

export interface PersonalContext {
  // Số ngày phép năm còn lại của chính người hỏi (có thể là số lẻ; âm = đã ứng trước).
  // null = không tra được lúc này (lỗi hệ thống) — không phải "0 ngày".
  leaveBalanceDays: number | null;
}

export interface PersonalAsker {
  accountId: string;
  // _id của UserInfo (nhân viên) — khoá của sổ ngày phép.
  userInfoId: string;
}

export interface PersonalContextProvider {
  getForAsker(asker: PersonalAsker): Promise<PersonalContext>;
}
