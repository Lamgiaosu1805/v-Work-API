import { loadEmployeeRules } from "../core/authorization/employee-permissions";
import type { OwnTicketLookupProvider } from "../modules/handbook-assistant";
import { buildAbility } from "../modules/permission";
import { describeOwnTickets } from "../modules/ticket";

// Cài đặt cổng OwnTicketLookupProvider của Trợ lý Nội quy bằng module `ticket`: cho trợ lý biết tình trạng MỘT ticket cụ
// thể (theo mã TK-... trong câu hỏi) để trả lời "ticket của tôi đang thế nào". Sống ở workflows/ vì cần nối nhiều module
// (handbook-assistant + ticket + permission) mà module không được import lẫn nhau.
//
// BẢO MẬT — chỉ ticket do CHÍNH người hỏi tạo:
//  - hàm chỉ nhận danh tính LẤY TỪ SOCKET ĐÃ XÁC THỰC (`asker.userInfoId`); mã ticket trong câu hỏi chỉ để CHỌN trong số
//    ticket mà `created_by` = chính người hỏi (điều kiện nằm trong câu truy vấn của module ticket, không lọc sau);
//  - ticket của người khác, ticket không tồn tại, ticket đã xoá đều như nhau: "không tìm thấy";
//  - người hỏi thấy đến đâu thì trợ lý biết đến đó (ticket hạn chế đã đóng chỉ còn thông tin chung); không có mô tả,
//    thông tin khách, nội dung trao đổi hay tên file.
// Lỗi tra cứu ném ra để trình chạy của trợ lý ghi "chưa tra được lúc này" (không đoán là không có).
export function createHandbookOwnTicketLookup(
  loadRules: typeof loadEmployeeRules = loadEmployeeRules,
  describe: typeof describeOwnTickets = describeOwnTickets
): OwnTicketLookupProvider {
  return {
    async lookup({ userInfoId }, codes) {
      const ability = buildAbility(await loadRules(userInfoId));
      return describe({
        employeeId: userInfoId,
        ability: { can: (action, subject) => ability.can(action, subject) },
        codes
      });
    }
  };
}
