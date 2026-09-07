import { listEmployeesByRoleCodes } from "../modules/permission";
import { listSaleOmicallProfilesBySaleIds } from "../modules/customer-call";

const CRM_SALE_CANDIDATE_ROLE_CODES = ["CRM_SALE", "CRM_SALE_MANAGER", "CRM_SALE_TEAM_LEAD"];

export interface CrmSaleCandidateEmployee {
  employeeId: string;
  fullName: string;
  email: string | null;
  roleCode: string;
  roleName: string;
}

export async function listCrmSaleCandidateEmployees(): Promise<CrmSaleCandidateEmployee[]> {
  const employees = await listEmployeesByRoleCodes(CRM_SALE_CANDIDATE_ROLE_CODES);

  const profiles = await listSaleOmicallProfilesBySaleIds(
    employees.map((employee) => employee.employeeId)
  );
  const employeeIdsWithProfile = new Set(profiles.map((profile) => profile.saleId));

  return employees
    .filter((employee) => !employeeIdsWithProfile.has(employee.employeeId))
    .map((employee) => ({
      employeeId: employee.employeeId,
      fullName: employee.fullName,
      email: employee.email,
      roleCode: employee.roleCode,
      roleName: employee.roleName
    }));
}
