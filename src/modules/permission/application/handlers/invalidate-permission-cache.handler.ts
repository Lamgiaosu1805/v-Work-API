import redis from "../../../../config/redis";
import { logger } from "../../../../config/logger";
import { eventBus } from "../../../../core/events/event-bus";
import { buildPermissionCacheKey } from "../../../../core/authorization/permission-cache-key";
import PermissionRoleModel from "../../../../models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../../../../models/EmployeePermissionProfileModel";
import { RoleDeletedDomainEvent } from "../../domain/events/role-deleted.domain-event";
import { EmployeePermissionUpdatedDomainEvent } from "../../domain/events/employee-permission-updated.domain-event";
import { DataScopePolicyChangedDomainEvent } from "../../domain/events/data-scope-policy-changed.domain-event";
import { FieldScopePolicyChangedDomainEvent } from "../../domain/events/field-scope-policy-changed.domain-event";

async function invalidateEmployeeCaches(employeeIds: string[]): Promise<void> {
  if (!employeeIds.length) return;
  try {
    await Promise.all(
      employeeIds.map((employeeId) => redis.del(buildPermissionCacheKey(employeeId)))
    );
  } catch (error) {
    logger.error("Không xóa được cache quyền nhân viên", { error, employeeIds });
  }
}

async function findAffectedEmployeeIdsForPolicy(
  policyCode: string,
  grantField: "dataScopePolicyCode" | "fieldScopePolicyCode"
): Promise<string[]> {
  const roles = await PermissionRoleModel.find({
    [`grants.${grantField}`]: policyCode,
    isDeleted: false
  })
    .select("_id")
    .lean();
  const roleIds = roles.map((role: any) => role._id);
  if (!roleIds.length) return [];

  const profiles = await EmployeePermissionProfileModel.find({
    roleIds: { $in: roleIds },
    isDeleted: false
  })
    .select("employeeId")
    .lean();

  return profiles.map((profile: any) => String(profile.employeeId));
}

async function onRoleDeleted(event: RoleDeletedDomainEvent): Promise<void> {
  await invalidateEmployeeCaches(event.affectedEmployeeIds);
}

async function onEmployeePermissionUpdated(
  event: EmployeePermissionUpdatedDomainEvent
): Promise<void> {
  await invalidateEmployeeCaches([event.employeeId]);
}

async function onDataScopePolicyChanged(event: DataScopePolicyChangedDomainEvent): Promise<void> {
  const employeeIds = await findAffectedEmployeeIdsForPolicy(
    event.policyCode,
    "dataScopePolicyCode"
  );
  await invalidateEmployeeCaches(employeeIds);
}

async function onFieldScopePolicyChanged(event: FieldScopePolicyChangedDomainEvent): Promise<void> {
  const employeeIds = await findAffectedEmployeeIdsForPolicy(
    event.policyCode,
    "fieldScopePolicyCode"
  );
  await invalidateEmployeeCaches(employeeIds);
}

eventBus.on(RoleDeletedDomainEvent.name, onRoleDeleted);
eventBus.on(EmployeePermissionUpdatedDomainEvent.name, onEmployeePermissionUpdated);
eventBus.on(DataScopePolicyChangedDomainEvent.name, onDataScopePolicyChanged);
eventBus.on(FieldScopePolicyChangedDomainEvent.name, onFieldScopePolicyChanged);

export {
  onRoleDeleted,
  onEmployeePermissionUpdated,
  onDataScopePolicyChanged,
  onFieldScopePolicyChanged
};
