import { listEmployeesByRoleCodes } from "../modules/permission";

export const CRM_SALE_CANDIDATE_ROLE_CODES = ["CRM_SALE", "CRM_SALE_MANAGER", "CRM_SALE_TEAM_LEAD"];

export interface CrmSaleCandidateEmployee {
  employeeId: string;
  fullName: string;
  email: string | null;
  roleCode: string;
  roleName: string;
}

export async function listCrmSaleCandidateEmployees(): Promise<CrmSaleCandidateEmployee[]> {
  const employees = await listEmployeesByRoleCodes(CRM_SALE_CANDIDATE_ROLE_CODES);

  return employees.map((employee) => ({
    employeeId: employee.employeeId,
    fullName: employee.fullName,
    email: employee.email,
    roleCode: employee.roleCode,
    roleName: employee.roleName
  }));
}
