import {
  listSaleOmicallProfilesBySaleIds,
  removeSaleOmicallProfile
} from "../modules/customer-call";
import { OmicallClient } from "../utils/omicallClient";
import { logger } from "../config/logger";
import { setCrmSaleRoleId } from "./set-crm-sale-role.workflow";

const omicallClient = new OmicallClient();

export async function removeCrmSaleEmployee(employeeId: string): Promise<void> {
  await setCrmSaleRoleId(employeeId, null);

  const [profile] = await listSaleOmicallProfilesBySaleIds([employeeId]);
  if (!profile) return;

  if (profile.omicallEmail) {
    try {
      await omicallClient.deleteAgent(profile.omicallEmail);
    } catch (error) {
      logger.error("Xóa agent Omicall thất bại khi gỡ nhân viên CRM sale", {
        employeeId,
        email: profile.omicallEmail,
        error: (error as Error).message
      });
    }
  }

  await removeSaleOmicallProfile(employeeId);
}
