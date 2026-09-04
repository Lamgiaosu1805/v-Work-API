import UserInfoModel from "../models/UserInfoModel";
import { listSaleOmicallProfilesBySaleIds } from "../modules/customer-call";
import { OmicallClient } from "../utils/omicallClient";
import {
  ArgumentInvalidException,
  ConflictException,
  NotFoundException
} from "../core/exceptions/exceptions";

const omicallClient = new OmicallClient();

export interface TransferCrmSaleEmployeeResult {
  requestId: string;
}

export async function transferCrmSaleEmployee(
  sourceEmployeeId: string,
  targetEmployeeId: string
): Promise<TransferCrmSaleEmployeeResult> {
  if (sourceEmployeeId === targetEmployeeId) {
    throw new ArgumentInvalidException("Không thể chuyển giao cho chính nhân viên đó");
  }

  const [sourceProfile] = await listSaleOmicallProfilesBySaleIds([sourceEmployeeId]);
  if (!sourceProfile?.omicallEmail) {
    throw new NotFoundException("Nhân viên nguồn chưa có tài khoản Omicall để chuyển giao", {
      metadata: { sourceEmployeeId }
    });
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
    return { requestId: result.requestId };
  } catch (error) {
    throw new ConflictException("Gọi chuyển giao Omicall thất bại", {
      metadata: {
        sourceEmail: sourceProfile.omicallEmail,
        targetEmail,
        cause: (error as Error).message
      }
    });
  }
}
