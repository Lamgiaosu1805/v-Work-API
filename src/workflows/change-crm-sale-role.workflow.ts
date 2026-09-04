import { findRolesByCodes } from "../modules/permission";
import { NotFoundException } from "../core/exceptions/exceptions";
import { setCrmSaleRoleId } from "./set-crm-sale-role.workflow";
import { CrmSaleRoleCode } from "./crm-sale-roles.constants";

export async function changeCrmSaleRole(
  employeeId: string,
  roleCode: CrmSaleRoleCode
): Promise<void> {
  const [role] = await findRolesByCodes([roleCode]);
  if (!role) {
    throw new NotFoundException("Role CRM chưa được seed trong hệ thống", {
      metadata: { roleCode }
    });
  }
  await setCrmSaleRoleId(employeeId, role.id);
}
