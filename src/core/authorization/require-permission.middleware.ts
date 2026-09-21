import { NextFunction, Request, Response } from "express";
import redis from "../../config/redis";
import { logger } from "../../config/logger";
import { asyncHandler } from "../http/async-handler";
import { ForbiddenException } from "../exceptions/exceptions";
import {
  resolveEffectiveRules,
  buildAbility,
  Ability,
  RawCaslRule
} from "../../modules/permission";
import { buildPermissionCacheKey } from "./permission-cache-key";
import { resolveEmployeeId } from "./resolve-employee-id";

declare global {
  namespace Express {
    interface Request {
      permissionAbility?: Ability;
    }
  }
}

async function loadRules(employeeId: string): Promise<RawCaslRule[]> {
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

export function requirePermission(action: string, subject: string) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.account?._id) {
      throw new ForbiddenException("Chưa đăng nhập");
    }

    const employeeId = await resolveEmployeeId(req.account._id);
    const rawRules = await loadRules(employeeId);
    const ability = buildAbility(rawRules);

    if (!ability.can(action, subject)) {
      throw new ForbiddenException("Bạn không có quyền thực hiện thao tác này");
    }

    req.permissionAbility = ability;
    next();
  });
}
