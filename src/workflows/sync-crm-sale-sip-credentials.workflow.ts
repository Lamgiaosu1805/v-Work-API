import { listEmployeesByRoleCodes } from "../modules/permission";
import { getSipCredentials, SipCredentials } from "../modules/customer-call";
import { OmicallClient, extractOmicallErrorMessage } from "../utils/omicallClient";
import { logger } from "../config/logger";
import {
  ArgumentInvalidException,
  NotFoundException,
  ConflictException
} from "../core/exceptions/exceptions";
import {
  CRM_SALE_ROLE_CODES,
  CrmSaleRoleCode,
  OMICALL_ROLE_NAME_BY_CODE
} from "./crm-sale-roles.constants";
import { generateOmicallPassword } from "./generate-omicall-password.util";

const omicallClient = new OmicallClient();

export async function syncCrmSaleSipCredentials(employeeId: string): Promise<SipCredentials> {
  const employees = await listEmployeesByRoleCodes(CRM_SALE_ROLE_CODES);
  const employee = employees.find((item) => item.employeeId === employeeId);
  if (!employee) {
    throw new NotFoundException("Nhân viên không có role Sale CRM", { metadata: { employeeId } });
  }
  if (!employee.email) {
    throw new ArgumentInvalidException("Nhân viên chưa có email — không thể tạo tài khoản Omicall");
  }

  try {
    await omicallClient.inviteAgent({
      identifyInfo: employee.email,
      fullName: employee.fullName,
      roleName: OMICALL_ROLE_NAME_BY_CODE[employee.roleCode as CrmSaleRoleCode],
      password: generateOmicallPassword()
    });
  } catch (error) {
    const omicallErrorMessage = extractOmicallErrorMessage(error);
    logger.error("Tạo tài khoản Omicall thất bại — chưa đồng bộ SIP", {
      employeeId,
      email: employee.email,
      omicallErrorMessage,
      responseData: (error as { response?: { data?: unknown } })?.response?.data
    });
    throw new ConflictException(`Tạo tài khoản Omicall thất bại: ${omicallErrorMessage}`, {
      metadata: { employeeId, email: employee.email, omicallErrorMessage }
    });
  }

  return getSipCredentials(employeeId, true);
}
