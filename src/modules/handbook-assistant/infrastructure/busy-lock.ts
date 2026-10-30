import redis from "../../../config/redis";
import { logger } from "../../../config/logger";

// Khoá "tài khoản đang có câu trả lời chạy" trên Redis, bổ sung cho registry trong tiến trình: khi
// deploy, container mới có thể khởi động trong lúc container cũ còn đang stream — khoá này giữ đúng
// quy tắc 1 câu/tài khoản giữa các tiến trình. TTL tự gỡ khoá nếu tiến trình chết giữa chừng.
export type ReleaseLock = () => Promise<void>;

const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");

const keyOf = (accountId: string): string => `${ENV_PREFIX}:handbook:busy:${accountId}`;

// Trả về null khi tiến trình khác đang giữ khoá (→ BUSY). Redis lỗi thì cho qua (fail-open): registry
// trong tiến trình vẫn bảo vệ, và không để sự cố Redis chặn toàn bộ trợ lý.
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
    logger.error("Không lấy được khoá busy của Trợ lý Nội quy trên Redis, bỏ qua", {
      accountId,
      error
    });
    return async () => undefined;
  }
  return async () => {
    try {
      if ((await redis.get(key)) === token) await redis.del(key);
    } catch (error) {
      logger.error("Không nhả được khoá busy của Trợ lý Nội quy", { accountId, error });
    }
  };
}
