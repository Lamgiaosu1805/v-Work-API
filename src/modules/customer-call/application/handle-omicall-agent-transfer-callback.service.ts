import UserInfoModel from "../../../models/UserInfoModel";
import redis from "../../../config/redis";
import { logger } from "../../../config/logger";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const CALLBACK_LOG_KEY = "omicall:agent-transfer:webhook:logs";
const CALLBACK_LOG_LIMIT = 50;

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

interface OmicallAgentTransferWebhookBody {
  requestId?: string;
  status?: string; // "SUCCESS" | "ERROR"
  payload?: { fullName?: string; phoneNumber?: string; email?: string };
}

export async function handleOmicallAgentTransferCallback(body: unknown): Promise<void> {
  const webhookBody = (body ?? {}) as OmicallAgentTransferWebhookBody;

  try {
    await redis.lpush(
      CALLBACK_LOG_KEY,
      JSON.stringify({ receivedAt: new Date().toISOString(), payload: webhookBody })
    );
    await redis.ltrim(CALLBACK_LOG_KEY, 0, CALLBACK_LOG_LIMIT - 1);
  } catch (error) {
    logger.error("Ghi log callback chuyển giao agent Omicall vào Redis thất bại", {
      error: (error as Error).message
    });
  }

  const requestId = webhookBody.requestId ?? null;
  const targetEmail = webhookBody.payload?.email ?? null;
  const isSuccess = webhookBody.status === "SUCCESS";

  let profile = requestId
    ? await saleOmicallProfileRepository.findByPendingTransferRequestId(requestId)
    : null;

  if (!profile && targetEmail) {
    const targetUserInfo = await UserInfoModel.findOne({ email: targetEmail, isDeleted: false })
      .select("_id")
      .lean();
    if (targetUserInfo) {
      profile = await saleOmicallProfileRepository.findTransferringByTargetSaleId(
        String((targetUserInfo as { _id: unknown })._id)
      );
    }
  }

  if (!profile) {
    logger.warn("Callback chuyển giao agent Omicall: không tìm thấy giao dịch đang chờ tương ứng", {
      requestId,
      targetEmail,
      status: webhookBody.status
    });
    return;
  }

  if (isSuccess) {
    profile.completeTransferSuccess(targetEmail ?? profile.omicallEmail);
    await saleOmicallProfileRepository.updateById(profile.id, profile);
    logger.info("Chuyển giao agent Omicall thành công (theo webhook)", {
      requestId,
      targetEmail,
      profileId: profile.id
    });
    return;
  }

  profile.completeTransferFailure();
  await saleOmicallProfileRepository.updateById(profile.id, profile);
  logger.error("Chuyển giao agent Omicall thất bại (theo webhook)", {
    requestId,
    sourceEmail: profile.omicallEmail,
    targetEmail,
    status: webhookBody.status
  });
}
