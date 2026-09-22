import { listEmployeesByRoleCodes } from "../modules/permission";
import { getSipCredentials, SipCredentials } from "../modules/customer-call";
import { ArgumentInvalidException, NotFoundException } from "../core/exceptions/exceptions";
import { CRM_SALE_ROLE_CODES } from "./crm-sale-roles.constants";

export async function syncCrmSaleSipCredentials(employeeId: string): Promise<SipCredentials> {
  const employees = await listEmployeesByRoleCodes(CRM_SALE_ROLE_CODES);
  const employee = employees.find((item) => item.employeeId === employeeId);
  if (!employee) {
    throw new NotFoundException("Nhân viên không có role Sale CRM", { metadata: { employeeId } });
  }
  if (!employee.email) {
    throw new ArgumentInvalidException("Nhân viên chưa có email — không thể tạo tài khoản Omicall");
  }

  return getSipCredentials(employeeId, true);
}
