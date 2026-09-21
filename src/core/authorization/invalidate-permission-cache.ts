import redis from "../../config/redis";
import { logger } from "../../config/logger";
import { buildPermissionCacheKey } from "./permission-cache-key";

export async function invalidatePermissionCache(
  employeeIds: (string | null | undefined)[]
): Promise<void> {
  const ids = Array.from(new Set(employeeIds.filter((id): id is string => Boolean(id))));
  if (!ids.length) return;

  try {
    await Promise.all(ids.map((employeeId) => redis.del(buildPermissionCacheKey(employeeId))));
  } catch (error) {
    logger.error("Không xóa được cache quyền nhân viên", { error, employeeIds: ids });
  }
}
