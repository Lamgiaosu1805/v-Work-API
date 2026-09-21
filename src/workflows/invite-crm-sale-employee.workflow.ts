import UserInfoModel from "../models/UserInfoModel";
import { findRolesByCodes } from "../modules/permission";
import { getSipCredentials, SipCredentials } from "../modules/customer-call";
import { OmicallClient, extractOmicallErrorMessage } from "../utils/omicallClient";
import { logger } from "../config/logger";
import {
  ArgumentInvalidException,
  ConflictException,
  NotFoundException
} from "../core/exceptions/exceptions";
import { setCrmSaleRoleId } from "./set-crm-sale-role.workflow";
import { CrmSaleRoleCode, OMICALL_ROLE_NAME_BY_CODE } from "./crm-sale-roles.constants";
import { generateOmicallPassword } from "./generate-omicall-password.util";

const omicallClient = new OmicallClient();

export async function inviteCrmSaleEmployee(
  employeeId: string,
  roleCode: CrmSaleRoleCode
): Promise<SipCredentials> {
  const userInfo = await UserInfoModel.findOne({ _id: employeeId, isDeleted: false })
    .select("full_name email")
    .lean();
  if (!userInfo) {
    throw new NotFoundException("Không tìm thấy nhân viên", { metadata: { employeeId } });
  }

  const { email } = userInfo as { email?: string | null };
  if (!email) {
    throw new ArgumentInvalidException("Nhân viên chưa có email — không thể tạo tài khoản Omicall");
  }

  const [role] = await findRolesByCodes([roleCode]);
  if (!role) {
    throw new NotFoundException("Role CRM chưa được seed trong hệ thống", {
      metadata: { roleCode }
    });
  }

  try {
    await omicallClient.inviteAgent({
      identifyInfo: email,
      fullName: (userInfo as { full_name: string }).full_name,
      roleName: OMICALL_ROLE_NAME_BY_CODE[roleCode],
      password: generateOmicallPassword()
    });
  } catch (error) {
    const omicallErrorMessage = extractOmicallErrorMessage(error);
    logger.error("Tạo tài khoản Omicall thất bại — chưa gán quyền Sale CRM", {
      employeeId,
      email,
      omicallErrorMessage,
      responseData: (error as { response?: { data?: unknown } })?.response?.data
    });
    throw new ConflictException(`Tạo tài khoản Omicall thất bại: ${omicallErrorMessage}`, {
      metadata: { employeeId, email, omicallErrorMessage }
    });
  }

  await setCrmSaleRoleId(employeeId, role.id);

  return getSipCredentials(employeeId, true);
}
