import { listEmployeesByRoleCodes } from "../modules/permission";
import {
  listSaleOmicallProfilesBySaleIds,
  listOmicallAgentsByEmail
} from "../modules/customer-call";
import { CRM_SALE_ROLE_CODES } from "./crm-sale-roles.constants";

export type OmicallSyncStatus = "synced" | "mismatch" | "inactive" | "not_found";

export interface CrmSaleEmployeeItem {
  employeeId: string;
  fullName: string;
  email: string | null;
  roleId: string;
  roleCode: string;
  roleName: string;
  omicallExtension: string | null;
  omicallSyncStatus: OmicallSyncStatus | null;
  isActive: boolean;
}

export async function listCrmSaleEmployees(): Promise<CrmSaleEmployeeItem[]> {
  const employees = await listEmployeesByRoleCodes(CRM_SALE_ROLE_CODES);
  const [profiles, agentsByEmail] = await Promise.all([
    listSaleOmicallProfilesBySaleIds(employees.map((employee) => employee.employeeId)),
    listOmicallAgentsByEmail().catch(() => new Map())
  ]);
  const profileBySaleId = new Map(profiles.map((profile) => [profile.saleId, profile]));

  return employees.map((employee) => {
    const profile = profileBySaleId.get(employee.employeeId);
    let omicallSyncStatus: OmicallSyncStatus | null = null;

    if (profile) {
      const agent = profile.omicallEmail ? agentsByEmail.get(profile.omicallEmail) : undefined;
      if (!agent) {
        omicallSyncStatus = "not_found";
      } else if (!agent.is_active) {
        omicallSyncStatus = "inactive";
      } else if (
        agent.pbx_account.sip_user !== profile.omicallExtension ||
        agent.pbx_account.sip_password !== profile.sipPassword
      ) {
        omicallSyncStatus = "mismatch";
      } else {
        omicallSyncStatus = "synced";
      }
    }

    return {
      employeeId: employee.employeeId,
      fullName: employee.fullName,
      email: employee.email,
      roleId: employee.roleId,
      roleCode: employee.roleCode,
      roleName: employee.roleName,
      omicallExtension: profile?.omicallExtension ?? null,
      omicallSyncStatus,
      isActive: !employee.accountIsDeleted
    };
  });
}
