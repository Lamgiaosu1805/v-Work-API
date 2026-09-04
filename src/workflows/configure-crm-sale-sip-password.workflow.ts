import crypto from "crypto";
import {
  listSaleOmicallProfilesBySaleIds,
  updateSaleOmicallPassword
} from "../modules/customer-call";
import { OmicallClient } from "../utils/omicallClient";
import { ConflictException, NotFoundException } from "../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

function generateOmicallPassword(): string {
  const random = crypto
    .randomBytes(9)
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "");
  return `Om1${random}!`;
}

export interface ConfigureCrmSaleSipPasswordResult {
  sipUser: string;
  newPassword: string;
}

export async function configureCrmSaleSipPassword(
  employeeId: string
): Promise<ConfigureCrmSaleSipPasswordResult> {
  const [profile] = await listSaleOmicallProfilesBySaleIds([employeeId]);
  if (!profile) {
    throw new NotFoundException("Nhân viên chưa có SIP profile để cấu hình", {
      metadata: { employeeId }
    });
  }

  const newPassword = generateOmicallPassword();

  try {
    await omicallClient.updateInternalPhone({
      sipUser: profile.omicallExtension,
      password: newPassword
    });
  } catch (error) {
    throw new ConflictException("Cập nhật mật khẩu SIP trên Omicall thất bại", {
      metadata: { sipUser: profile.omicallExtension, cause: (error as Error).message }
    });
  }

  await updateSaleOmicallPassword(employeeId, newPassword);

  return { sipUser: profile.omicallExtension, newPassword };
}
