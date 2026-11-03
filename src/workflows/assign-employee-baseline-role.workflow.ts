import {
  findRolesByCodes,
  getEmployeePermissionProfile,
  updateEmployeePermission
} from "../modules/permission";
import { logger } from "../config/logger";

export const EMPLOYEE_BASELINE_ROLE_CODE = "EMPLOYEE_BASELINE";

// Gán role EMPLOYEE_BASELINE cho nhân viên mới tạo, giữ nguyên role/override đã có. Chạy sau khi transaction
// tạo nhân viên đã commit nên không được ném lỗi — nhân viên đã tồn tại, lỗi chỉ log để admin gán tay.
export async function assignEmployeeBaselineRole(employeeId: string): Promise<boolean> {
  try {
    const [role] = await findRolesByCodes([EMPLOYEE_BASELINE_ROLE_CODE]);
    if (!role) {
      logger.warn("Role EMPLOYEE_BASELINE chưa được seed — bỏ qua gán quyền mặc định", {
        employeeId
      });
      return false;
    }

    const profile = await getEmployeePermissionProfile(employeeId);
    const roleIds = profile.assignedRoles.map((assignedRole) => assignedRole.id);
    if (roleIds.includes(role.id)) return true;

    await updateEmployeePermission(employeeId, {
      roleIds: [...roleIds, role.id],
      overrides: profile.overrides
    });
    return true;
  } catch (error) {
    logger.error("Gán role EMPLOYEE_BASELINE cho nhân viên mới thất bại", {
      employeeId,
      error: (error as Error)?.message
    });
    return false;
  }
}
