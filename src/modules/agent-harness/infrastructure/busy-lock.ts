import redis from "../../../config/redis";
import { logger } from "../../../config/logger";

// Khoá "tài khoản đang có câu trả lời chạy" trên Redis (giữa các tiến trình, vd lúc deploy chồng). TTL tự gỡ nếu
// tiến trình chết. Redis lỗi → cho qua (registry trong tiến trình vẫn chặn trùng).
export type ReleaseLock = () => Promise<void>;

const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");
const keyOf = (accountId: string): string => `${ENV_PREFIX}:agent:busy:${accountId}`;

export async function acquireBusyLock(
  accountId: string,
  ttlMs: number
): Promise<ReleaseLock | null> {
  const key = keyOf(accountId);
  const token = `${Date.now()}-${Math.random()}`;
  try {
    const ok = await redis.set(key, token, "PX", ttlMs, "NX");
    if (ok !== "OK") return null;
  } catch (error) {
    logger.error("Agent harness: không lấy được khoá busy trên Redis, bỏ qua", {
      accountId,
      error
    });
    return async () => undefined;
  }
  return async () => {
    try {
      if ((await redis.get(key)) === token) await redis.del(key);
    } catch (error) {
      logger.error("Agent harness: không nhả được khoá busy", { accountId, error });
    }
  };
}
