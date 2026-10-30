import { logger } from "../config/logger";
import type { PersonalContextProvider } from "../modules/handbook-assistant";
import { getLeaveBalance } from "../modules/leave";

// Cài đặt cổng PersonalContextProvider của Trợ lý Nội quy bằng module `leave`: cho trợ lý biết số ngày phép năm
// còn lại của CHÍNH người đang hỏi để trả lời "tôi còn bao nhiêu ngày phép". Sống ở workflows/ vì cần nối 2 module
// (handbook-assistant + leave) mà module không được import lẫn nhau.
//
// Chỉ tra theo `asker.userInfoId` do socket đã xác thực đưa vào — hàm này không có đường nào nhận id của nhân
// viên khác, nên dù câu hỏi nhắc tên/mã người khác thì dữ liệu của họ cũng không bao giờ được truy vấn.
// Lỗi tra cứu không ném ra ngoài: trả `leaveBalanceDays: null` để trợ lý nói "chưa tra được lúc này" thay vì
// đoán hay làm hỏng cả câu trả lời.
export function createHandbookPersonalContext(): PersonalContextProvider {
  return {
    async getForAsker({ userInfoId }) {
      try {
        return { leaveBalanceDays: await getLeaveBalance(userInfoId) };
      } catch (error) {
        logger.warn("Trợ lý Nội quy: không tra được ngày phép còn lại của người hỏi", {
          error: error instanceof Error ? error.message : String(error)
        });
        return { leaveBalanceDays: null };
      }
    }
  };
}
