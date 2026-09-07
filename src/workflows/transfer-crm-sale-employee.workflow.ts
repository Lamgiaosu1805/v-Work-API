import UserInfoModel from "../models/UserInfoModel";
import {
  listSaleOmicallProfilesBySaleIds,
  beginSaleOmicallProfileTransfer
} from "../modules/customer-call";
import { OmicallClient, extractOmicallErrorMessage } from "../utils/omicallClient";
import { logger } from "../config/logger";
import {
  ArgumentInvalidException,
  ConflictException,
  NotFoundException
} from "../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export interface TransferCrmSaleEmployeeResult {
  requestId: string | null;
}

export async function transferCrmSaleEmployee(
  sourceEmployeeId: string,
  targetEmployeeId: string
): Promise<TransferCrmSaleEmployeeResult> {
  if (sourceEmployeeId === targetEmployeeId) {
    throw new ArgumentInvalidException("Không thể chuyển giao cho chính nhân viên đó");
  }

  const [sourceProfile, targetProfile] = await listSaleOmicallProfilesBySaleIds([
    sourceEmployeeId,
    targetEmployeeId
  ]).then((profiles) => [
    profiles.find((profile) => profile.saleId === sourceEmployeeId),
    profiles.find((profile) => profile.saleId === targetEmployeeId)
  ]);
  if (!sourceProfile?.omicallEmail) {
    throw new NotFoundException("Nhân viên nguồn chưa có tài khoản Omicall để chuyển giao", {
      metadata: { sourceEmployeeId }
    });
  }
  if (sourceProfile.status === "transferring") {
    throw new ConflictException(
      "Nhân viên nguồn đang có 1 giao dịch chuyển giao khác chưa xử lý xong",
      { metadata: { sourceEmployeeId } }
    );
  }
  if (targetProfile) {
    throw new ArgumentInvalidException(
      "Nhân viên nhận đã có tài khoản Omicall — không thể chuyển giao",
      { metadata: { targetEmployeeId } }
    );
  }

  const targetUserInfo = await UserInfoModel.findOne({ _id: targetEmployeeId, isDeleted: false })
    .select("full_name email phone_number")
    .lean();
  if (!targetUserInfo) {
    throw new NotFoundException("Không tìm thấy nhân viên nhận chuyển giao", {
      metadata: { targetEmployeeId }
    });
  }

  const { email: targetEmail } = targetUserInfo as { email?: string | null };
  if (!targetEmail) {
    throw new ArgumentInvalidException(
      "Nhân viên nhận chuyển giao chưa có email — không thể chuyển giao qua Omicall"
    );
  }

  try {
    const result = await omicallClient.transferAgent({
      sourceEmail: sourceProfile.omicallEmail,
      targetEmail,
      targetInfo: {
        fullName: (targetUserInfo as { full_name: string }).full_name,
        phoneNumber: (targetUserInfo as { phone_number?: string }).phone_number
      },
      callbackResultConfig: {
        url: `${process.env.BASE_URL}/customer-call/webhooks/omicall-agent-transfer`
      }
    });
    await beginSaleOmicallProfileTransfer(sourceEmployeeId, result.requestId, targetEmployeeId);
    return { requestId: result.requestId };
  } catch (error) {
    const omicallErrorMessage = extractOmicallErrorMessage(error);
    logger.error("Gọi chuyển giao Omicall thất bại", {
      sourceEmail: sourceProfile.omicallEmail,
      targetEmail,
      omicallErrorMessage,
      responseData: (error as { response?: { data?: unknown } })?.response?.data
    });
    throw new ConflictException(`Gọi chuyển giao Omicall thất bại: ${omicallErrorMessage}`, {
      metadata: { sourceEmail: sourceProfile.omicallEmail, targetEmail, omicallErrorMessage }
    });
  }
}
