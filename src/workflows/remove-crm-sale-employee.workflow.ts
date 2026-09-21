import {
  listSaleOmicallProfilesBySaleIds,
  removeSaleOmicallProfile
} from "../modules/customer-call";
import { OmicallClient, extractOmicallErrorMessage } from "../utils/omicallClient";
import { logger } from "../config/logger";
import { ConflictException } from "../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export async function removeCrmSaleEmployee(employeeId: string): Promise<void> {
  const [profile] = await listSaleOmicallProfilesBySaleIds([employeeId]);

  if (profile?.omicallEmail) {
    try {
      await omicallClient.deleteAgent(profile.omicallEmail);
    } catch (error) {
      const omicallErrorMessage = extractOmicallErrorMessage(error);
      logger.error("Xóa tài khoản Omicall thất bại — chưa gỡ tài khoản SIP", {
        employeeId,
        email: profile.omicallEmail,
        omicallErrorMessage,
        responseData: (error as { response?: { data?: unknown } })?.response?.data
      });
      throw new ConflictException(`Xóa tài khoản Omicall thất bại: ${omicallErrorMessage}`, {
        metadata: { employeeId, email: profile.omicallEmail, omicallErrorMessage }
      });
    }
  }

  await removeSaleOmicallProfile(employeeId);
}
