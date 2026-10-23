import { buildAbility } from "../../modules/permission";
import { loadRules } from "./require-permission.middleware";

// Kiểm tra quyền của một nhân viên NGOÀI Express (vd. socket handler), dùng chung cache Redis với
// requirePermission nên không tốn truy vấn DB ở mỗi sự kiện. `employeeId` là UserInfo._id (với socket
// là `socket.data.userInfoId`). Không có admin bypass — giống requirePermission.
export async function canEmployee(
  employeeId: string,
  action: string,
  subject: string
): Promise<boolean> {
  const rules = await loadRules(employeeId);
  return buildAbility(rules).can(action, subject);
}
