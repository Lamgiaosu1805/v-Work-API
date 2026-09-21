import { listEmployeesByRoleCodes } from "../modules/permission";
import { ArgumentInvalidException, NotFoundException } from "../core/exceptions/exceptions";
import { reassignSaleCustomers } from "./reassign-sale-customers.workflow";
import { CRM_SALE_CANDIDATE_ROLE_CODES } from "./list-crm-sale-candidate-employees.workflow";

export interface TransferCrmSaleEmployeeResult {
  reassignedCustomerCount: number;
}

export async function transferCrmSaleEmployee(
  sourceEmployeeId: string,
  targetEmployeeId: string
): Promise<TransferCrmSaleEmployeeResult> {
  if (sourceEmployeeId === targetEmployeeId) {
    throw new ArgumentInvalidException("Không thể chuyển giao cho chính nhân viên đó");
  }

  const crmSaleEmployees = await listEmployeesByRoleCodes(CRM_SALE_CANDIDATE_ROLE_CODES);
  const crmSaleEmployeeIds = new Set(crmSaleEmployees.map((employee) => employee.employeeId));

  if (!crmSaleEmployeeIds.has(sourceEmployeeId)) {
    throw new NotFoundException("Nhân viên nguồn không có role Sale CRM", {
      metadata: { sourceEmployeeId }
    });
  }
  if (!crmSaleEmployeeIds.has(targetEmployeeId)) {
    throw new NotFoundException("Nhân viên nhận chuyển giao không có role Sale CRM hợp lệ", {
      metadata: { targetEmployeeId }
    });
  }

  const reassignedCustomerCount = await reassignSaleCustomers(
    sourceEmployeeId,
    targetEmployeeId,
    "chuyển giao thủ công"
  );

  return { reassignedCustomerCount };
}
