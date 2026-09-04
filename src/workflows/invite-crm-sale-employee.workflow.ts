import crypto from "crypto";
import UserInfoModel from "../models/UserInfoModel";
import { findRolesByCodes } from "../modules/permission";
import { getSipCredentials, SipCredentials } from "../modules/customer-call";
import { OmicallClient } from "../utils/omicallClient";
import {
  ArgumentInvalidException,
  ConflictException,
  NotFoundException
} from "../core/exceptions/exceptions";
import { setCrmSaleRoleId } from "./set-crm-sale-role.workflow";
import { CrmSaleRoleCode, OMICALL_ROLE_NAME_BY_CODE } from "./crm-sale-roles.constants";

const omicallClient = new OmicallClient();

function generateOmicallPassword(): string {
  const random = crypto
    .randomBytes(9)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
  return `Om1${random}!`;
}

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

  await setCrmSaleRoleId(employeeId, role.id);

  try {
    await omicallClient.inviteAgent({
      identifyInfo: email,
      fullName: (userInfo as { full_name: string }).full_name,
      roleName: OMICALL_ROLE_NAME_BY_CODE[roleCode],
      password: generateOmicallPassword()
    });
  } catch (error) {
    throw new ConflictException(
      "Đã gán quyền Sale CRM nhưng tạo tài khoản Omicall thất bại — kiểm tra email đã dùng trên Omicall chưa rồi thử đồng bộ lại",
      { metadata: { email, cause: (error as Error).message } }
    );
  }

  return getSipCredentials(employeeId, true);
}
