import redis from "../../../config/redis";
import { LeaveLockTimeoutError } from "../domain/leave-balance.errors";

const LOCK_TTL_MS = 5000;
const LOCK_WAIT_BUDGET_MS = 10000;
const RETRY_DELAY_MIN_MS = 50;
const RETRY_DELAY_JITTER_MS = 50;

const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type ReleaseLock = () => Promise<void>;

export async function acquireUserLeaveLock(userId: string): Promise<ReleaseLock> {
  const key = `${ENV_PREFIX}:leave_balance:lock:${String(userId)}`;
  const token = `${Date.now()}-${Math.random()}`;
  const deadline = Date.now() + LOCK_WAIT_BUDGET_MS;

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await redis.set(key, token, "PX", LOCK_TTL_MS, "NX");
    if (ok === "OK") {
      return async () => {
        try {
          const val = await redis.get(key);
          if (val === token) await redis.del(key);
        } catch {
          // best-effort release — TTL là lưới an toàn thực sự
        }
      };
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(RETRY_DELAY_MIN_MS + Math.random() * RETRY_DELAY_JITTER_MS);
  }
  throw new LeaveLockTimeoutError();
}
