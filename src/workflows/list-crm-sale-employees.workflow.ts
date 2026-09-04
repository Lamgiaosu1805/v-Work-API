import { listEmployeesByRoleCodes } from "../modules/permission";
import { listSaleOmicallProfilesBySaleIds } from "../modules/customer-call";
import { CRM_SALE_ROLE_CODES } from "./crm-sale-roles.constants";

export interface CrmSaleEmployeeItem {
  employeeId: string;
  fullName: string;
  email: string | null;
  roleId: string;
  roleCode: string;
  roleName: string;
  omicallExtension: string | null;
  isActive: boolean;
}

export async function listCrmSaleEmployees(): Promise<CrmSaleEmployeeItem[]> {
  const employees = await listEmployeesByRoleCodes(CRM_SALE_ROLE_CODES);
  const profiles = await listSaleOmicallProfilesBySaleIds(
    employees.map((employee) => employee.employeeId)
  );
  const profileBySaleId = new Map(profiles.map((profile) => [profile.saleId, profile]));

  return employees.map((employee) => ({
    employeeId: employee.employeeId,
    fullName: employee.fullName,
    email: employee.email,
    roleId: employee.roleId,
    roleCode: employee.roleCode,
    roleName: employee.roleName,
    omicallExtension: profileBySaleId.get(employee.employeeId)?.omicallExtension ?? null,
    isActive: !employee.accountIsDeleted
  }));
}
