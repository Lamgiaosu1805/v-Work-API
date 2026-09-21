import { getEmployeePermissionProfile, updateEmployeePermission } from "../modules/permission";
import { CRM_SALE_ROLE_CODES, CrmSaleRoleCode } from "./crm-sale-roles.constants";

export async function setCrmSaleRoleId(
  employeeId: string,
  newRoleId: string | null
): Promise<void> {
  const profile = await getEmployeePermissionProfile(employeeId);
  const nonCrmRoleIds = profile.assignedRoles
    .filter((role) => !CRM_SALE_ROLE_CODES.includes(role.code as CrmSaleRoleCode))
    .map((role) => role.id);
  const roleIds = newRoleId ? [...nonCrmRoleIds, newRoleId] : nonCrmRoleIds;

  await updateEmployeePermission(employeeId, {
    roleIds,
    overrides: profile.overrides
  });
}
