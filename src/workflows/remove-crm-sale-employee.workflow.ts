import UserInfoModel from "../models/UserInfoModel";
import {
  listSaleOmicallProfilesBySaleIds,
  removeSaleOmicallProfile
} from "../modules/customer-call";
import { runInTransaction } from "../core/db/run-in-transaction";
import { OmicallClient, extractOmicallErrorMessage } from "../utils/omicallClient";
import { logger } from "../config/logger";
import { ConflictException } from "../core/exceptions/exceptions";
import { setCrmSaleRoleId } from "./set-crm-sale-role.workflow";

const omicallClient = new OmicallClient();

export async function removeCrmSaleEmployee(employeeId: string): Promise<void> {
  const [profile] = await listSaleOmicallProfilesBySaleIds([employeeId]);

  if (profile?.status === "transferring") {
    throw new ConflictException(
      "Nhân viên đang có 1 giao dịch chuyển giao chưa xử lý xong, không thể gỡ",
      { metadata: { employeeId } }
    );
  }

  if (profile?.omicallEmail) {
    try {
      await omicallClient.deleteAgent(profile.omicallEmail);
    } catch (error) {
      const omicallErrorMessage = extractOmicallErrorMessage(error);
      logger.error("Xóa tài khoản Omicall thất bại — chưa gỡ quyền Sale CRM", {
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

  await runInTransaction(async (session) => {
    await setCrmSaleRoleId(employeeId, null);
    await removeSaleOmicallProfile(employeeId);
    await UserInfoModel.updateOne({ _id: employeeId }, { email: null }, { session });
  });
}
