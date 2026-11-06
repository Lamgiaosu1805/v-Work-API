import { logger } from "../config/logger";
import { loadEmployeeRules } from "../core/authorization/employee-permissions";
import type { PersonalContextProvider, TicketAccess } from "../modules/handbook-assistant";
import { getLeaveBalance } from "../modules/leave";
import { buildAbility } from "../modules/permission";

// Cài đặt cổng PersonalContextProvider của Trợ lý Nội quy: cho trợ lý biết thông tin của CHÍNH người đang hỏi
//   - số ngày phép năm còn lại (module `leave`) để trả lời "tôi còn bao nhiêu ngày phép";
//   - những việc họ làm được với Ticket hỗ trợ (bộ quyền của họ) để hướng dẫn đúng việc họ thao tác được và nói rõ
//     việc nào họ chưa có quyền.
// Sống ở workflows/ vì cần nối nhiều module (handbook-assistant + leave + permission) mà module không được import lẫn nhau.
//
// Chỉ tra theo `asker.userInfoId` do socket đã xác thực đưa vào — hàm này không có đường nào nhận id của nhân
// viên khác, nên dù câu hỏi nhắc tên/mã người khác thì dữ liệu của họ cũng không bao giờ được truy vấn.
// Lỗi tra cứu không ném ra ngoài: ngày phép → `leaveBalanceDays: null`, quyền → `ticketAccess: null` để trợ lý nói
// "chưa tra được lúc này" thay vì đoán hay làm hỏng cả câu trả lời.

const TICKET_SUBJECT = "Ticket";

// Hàm thuần: từ hàm "có quyền không" dựng các cờ quyền Ticket của người hỏi.
export function computeTicketAccess(
  can: (action: string, subject: string) => boolean
): TicketAccess {
  const ticket = (action: string) => can(action, TICKET_SUBJECT);
  return {
    canCreate: ticket("ticket.create"),
    canView: ticket("ticket.view"),
    canHandle: ticket("ticket.handle"),
    canAssignDepartment: ticket("ticket.assign_department"),
    canAssignMember: ticket("ticket.assign_member"),
    canManage: ticket("ticket.manage"),
    canViewRestricted: ticket("ticket.view_restricted"),
    canViewSensitive: ticket("ticket.view_sensitive"),
    canConfig: ticket("ticket.config")
  };
}

export function createHandbookPersonalContext(
  loadRules: typeof loadEmployeeRules = loadEmployeeRules
): PersonalContextProvider {
  return {
    async getForAsker({ userInfoId }) {
      const [leaveBalanceDays, ticketAccess] = await Promise.all([
        getLeaveBalance(userInfoId).catch((error) => {
          logger.warn("Trợ lý Nội quy: không tra được ngày phép còn lại của người hỏi", {
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        }),
        loadRules(userInfoId)
          .then((rules) => {
            const ability = buildAbility(rules);
            return computeTicketAccess((action, subject) => ability.can(action, subject));
          })
          .catch((error) => {
            logger.warn("Trợ lý Nội quy: không tra được quyền ticket của người hỏi", {
              error: error instanceof Error ? error.message : String(error)
            });
            return null;
          })
      ]);
      return { leaveBalanceDays, ticketAccess };
    }
  };
}
