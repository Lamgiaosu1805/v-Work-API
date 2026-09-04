import redis from "../../../config/redis";
import { logger } from "../../../config/logger";

const CALLBACK_LOG_KEY = "omicall:agent-transfer:webhook:logs";
const CALLBACK_LOG_LIMIT = 50;

export async function handleOmicallAgentTransferCallback(payload: unknown): Promise<void> {
  try {
    logger.info("Nhận callback kết quả chuyển giao agent Omicall (chưa rõ payload shape thật)", {
      payload
    });

    await redis.lpush(
      CALLBACK_LOG_KEY,
      JSON.stringify({ receivedAt: new Date().toISOString(), payload })
    );
    await redis.ltrim(CALLBACK_LOG_KEY, 0, CALLBACK_LOG_LIMIT - 1);
  } catch (error) {
    logger.error("Xử lý callback chuyển giao agent Omicall thất bại", {
      error: (error as Error).message,
      payload
    });
  }
}
