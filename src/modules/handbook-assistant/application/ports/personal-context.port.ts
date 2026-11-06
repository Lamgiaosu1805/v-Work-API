// Cổng lấy thông tin CÁ NHÂN của người đang hỏi để trợ lý trả lời được những câu như "tôi còn bao nhiêu ngày phép".
// Module này không được import module khác (luật workflows/) nên dữ liệu đến từ bên ngoài qua cổng này —
// tầng workflows/ cài đặt (src/workflows/handbook-personal-context.workflow.ts), index.js nối vào socket.
//
// BẢO MẬT — chỉ ĐÚNG người hỏi:
//  - cổng chỉ nhận danh tính LẤY TỪ SOCKET ĐÃ XÁC THỰC; không có tham số nào để chỉ định nhân viên khác;
//  - danh tính không bao giờ lấy từ nội dung câu hỏi (kể cả khi câu hỏi nêu tên/mã nhân viên khác);
//  - dữ liệu của người khác không bao giờ được đưa vào prompt, nên model không thể làm lộ.

// Những việc CHÍNH người hỏi làm được với Ticket hỗ trợ (suy từ bộ quyền của họ), để trợ lý hướng dẫn đúng việc họ
// thật sự thao tác được và nói rõ việc nào họ chưa có quyền. Không phải quan hệ theo từng ticket (người tạo, chủ
// trì...) — cái đó domain ticket tính theo từng ticket.
export interface TicketAccess {
  canCreate: boolean;
  canView: boolean;
  // Nhận / trả lại / tạm hoãn / báo xong / đóng ticket (quyền xử lý).
  canHandle: boolean;
  canAssignDepartment: boolean;
  canAssignMember: boolean;
  // Quản lý ticket: đóng hộ, đổi chủ trì, sửa phân loại mọi ticket.
  canManage: boolean;
  canViewRestricted: boolean;
  canViewSensitive: boolean;
  canConfig: boolean;
}

export interface PersonalContext {
  // Số ngày phép năm còn lại của chính người hỏi (có thể là số lẻ; âm = đã ứng trước).
  // null = không tra được lúc này (lỗi hệ thống) — không phải "0 ngày".
  leaveBalanceDays: number | null;
  // Quyền Ticket của chính người hỏi. undefined = cổng chưa tra (prompt không nhắc tới); null = tra lỗi / quá hạn
  // (prompt ghi "chưa tra được", KHÔNG được hiểu là có hay không có quyền).
  ticketAccess?: TicketAccess | null;
}

export interface PersonalAsker {
  accountId: string;
  // _id của UserInfo (nhân viên) — khoá của sổ ngày phép.
  userInfoId: string;
}

export interface PersonalContextProvider {
  getForAsker(asker: PersonalAsker): Promise<PersonalContext>;
}
