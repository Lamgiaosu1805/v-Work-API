import redis from "../../config/redis";
import { logger } from "../../config/logger";
import { resolveEffectiveRules, buildAbility, RawCaslRule } from "../../modules/permission";
import { buildPermissionCacheKey } from "./permission-cache-key";

// Bộ quy tắc CASL hiệu lực của một nhân viên, đọc qua cache Redis (cùng cache với requirePermission).
export async function loadEmployeeRules(employeeId: string): Promise<RawCaslRule[]> {
  const cacheKey = buildPermissionCacheKey(employeeId);

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as RawCaslRule[];
  } catch (error) {
    logger.error("Không đọc được cache quyền nhân viên", { error, employeeId });
  }

  const rules = await resolveEffectiveRules(employeeId);

  try {
    await redis.set(cacheKey, JSON.stringify(rules));
  } catch (error) {
    logger.error("Không ghi được cache quyền nhân viên", { error, employeeId });
  }

  return rules;
}

// Trong danh sách nhân viên đã cho, những ai có quyền `action` (hoặc MỘT trong các quyền, nếu truyền mảng) trên
// `subject` — để kiểm tra người KHÁC (vd người được giao ticket có quyền xử lý không), không phải người đang gọi API.
export async function filterEmployeesWithPermission(
  employeeIds: string[],
  action: string | string[],
  subject: string
): Promise<string[]> {
  const actions = Array.isArray(action) ? action : [action];
  const unique = [...new Set(employeeIds.map(String))];
  const allowed = await Promise.all(
    unique.map(async (employeeId) => {
      try {
        const ability = buildAbility(await loadEmployeeRules(employeeId));
        return actions.some((item) => ability.can(item, subject)) ? employeeId : null;
      } catch (error) {
        logger.error("Không tính được quyền của nhân viên", { error, employeeId });
        return null;
      }
    })
  );
  return allowed.filter((id): id is string => id !== null);
}
