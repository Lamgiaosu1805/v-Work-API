import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../http/async-handler";
import { ForbiddenException } from "../exceptions/exceptions";
import { buildAbility, Ability, RawCaslRule } from "../../modules/permission";
import { loadEmployeeRules } from "./employee-permissions";
import { resolveEmployeeId } from "./resolve-employee-id";
import { resolveManagedRequestEmployeeIds } from "./resolve-managed-request-employee-ids";

declare global {
  namespace Express {
    interface Request {
      permissionAbility?: Ability;
    }
  }
}

export function requirePermission(action: string, subject: string) {
  return requireAnyPermission([action], subject);
}

// Có MỘT trong các quyền là qua (vd ticket.handle hoặc ticket.manage); ability gắn vào req như requirePermission.
export function requireAnyPermission(actions: string[], subject: string) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.account?._id) {
      throw new ForbiddenException("Chưa đăng nhập");
    }

    const employeeId = await resolveEmployeeId(req.account._id);
    const rawRules = await loadEmployeeRules(employeeId);
    if (subject === "Request") {
      const managedEmployeeIds = await resolveManagedRequestEmployeeIds(employeeId);
      if (managedEmployeeIds.length) {
        const conditions = {
          user_id: { $in: managedEmployeeIds }
        } as unknown as NonNullable<RawCaslRule["conditions"]>;
        rawRules.push(
          { action: "request.view", subject: "Request", conditions },
          { action: "request.review", subject: "Request", conditions }
        );
      }
    }
    const ability = buildAbility(rawRules);

    if (!actions.some((action) => ability.can(action, subject))) {
      throw new ForbiddenException("Bạn không có quyền thực hiện thao tác này");
    }

    req.permissionAbility = ability;
    next();
  });
}
