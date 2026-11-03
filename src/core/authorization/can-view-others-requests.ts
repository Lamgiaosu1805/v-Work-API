import { Ability } from "../../modules/permission";

// Có xem được đơn của người KHÁC không (tab "Đơn từ nhân sự"). Role Nhân viên cho mọi người request.view
// phạm vi REQUEST_SELF nên chỉ `ability.can` là chưa đủ: cần ít nhất 1 rule không điều kiện (toàn công ty /
// override không giới hạn) hoặc có điều kiện nhắc tới id khác chính mình (cùng phòng, người mình quản lý).
export function canViewOthersRequests(ability: Ability, employeeId: string): boolean {
  if (!ability.can("request.view", "Request")) return false;

  return ability.rulesFor("request.view", "Request").some((rule) => {
    if (rule.inverted) return false;
    if (!rule.conditions || !Object.keys(rule.conditions).length) return true;
    const ids: string[] = JSON.stringify(rule.conditions).match(/[0-9a-f]{24}/gi) ?? [];
    return ids.some((id) => id !== employeeId);
  });
}
