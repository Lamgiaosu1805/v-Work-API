import UserDepartmentPositionModel from "../../../models/UserDepartmentPositionModel";
import UserInfoModel from "../../../models/UserInfoModel";
import PermissionCatalogModel from "../../../models/PermissionCatalogModel";
import { EmployeePermissionProfileRepository } from "../infrastructure/employee-permission-profile.repository";
import { RoleRepository } from "../infrastructure/role.repository";
import { DataScopePolicyRepository } from "../infrastructure/data-scope-policy.repository";
import { FieldScopePolicyRepository } from "../infrastructure/field-scope-policy.repository";
import {
  compile,
  interpolate,
  emptyResolvedCondition,
  ResolvedCondition
} from "../domain/services/condition-compiler.service";
import {
  buildRawRules,
  ResolvedPermissionGrant,
  ResolvedOverride,
  RawCaslRule
} from "../domain/services/ability-rule-builder.service";
import { buildAbility, Ability } from "../infrastructure/casl-ability.factory";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";

const employeePermissionProfileRepository = new EmployeePermissionProfileRepository();
const roleRepository = new RoleRepository();
const dataScopePolicyRepository = new DataScopePolicyRepository();
const fieldScopePolicyRepository = new FieldScopePolicyRepository();

async function resolveSubjectContext(employeeId: string): Promise<Record<string, unknown>> {
  const [memberships, userInfo] = await Promise.all([
    UserDepartmentPositionModel.find({
      user: employeeId,
      isDeleted: false
    }).lean(),
    UserInfoModel.findById(employeeId).select("id_account").lean()
  ]);

  const departmentIds = memberships.map((membership: any) => String(membership.department));

  const colleagueMemberships = departmentIds.length
    ? await UserDepartmentPositionModel.find({
        department: { $in: departmentIds },
        isDeleted: false
      }).lean()
    : [];
  const departmentColleagueUserIds = Array.from(
    new Set(colleagueMemberships.map((membership: any) => String(membership.user)))
  );

  return {
    userId: employeeId,
    accountId: userInfo ? String((userInfo as { id_account: unknown }).id_account) : null,
    departmentId: departmentIds[0] ?? null,
    departmentIds,
    departmentColleagueUserIds
  };
}

export async function resolveEffectiveRules(employeeId: string): Promise<RawCaslRule[]> {
  const [profile, subject] = await Promise.all([
    employeePermissionProfileRepository.findByEmployeeId(employeeId),
    resolveSubjectContext(employeeId)
  ]);

  const roleIds = profile?.roleIds ?? [];
  const overrides = profile?.overrides ?? [];

  const roles = await roleRepository.findManyByIds(roleIds);
  const allGrants = roles.flatMap((role) => role.grants);

  const permissionCodes = Array.from(
    new Set([
      ...allGrants.map((grant) => grant.permissionCode),
      ...overrides.map((o) => o.permissionCode)
    ])
  );
  const dataScopePolicyCodes = Array.from(
    new Set([
      ...allGrants.map((grant) => grant.dataScopePolicyCode),
      ...overrides.map((o) => o.dataScopePolicyCode).filter((code): code is string => Boolean(code))
    ])
  );
  const fieldScopePolicyCodes = Array.from(
    new Set([
      ...allGrants.map((grant) => grant.fieldScopePolicyCode).filter(Boolean),
      ...overrides.map((o) => o.fieldScopePolicyCode).filter(Boolean)
    ] as string[])
  );

  const [catalogEntries, dataScopePolicies, fieldScopePolicies] = await Promise.all([
    PermissionCatalogModel.find({ code: { $in: permissionCodes }, isDeleted: false }).lean(),
    Promise.all(dataScopePolicyCodes.map((code) => dataScopePolicyRepository.findByCode(code))),
    Promise.all(fieldScopePolicyCodes.map((code) => fieldScopePolicyRepository.findByCode(code)))
  ]);

  const entityByPermissionCode = new Map(
    catalogEntries.map((entry: any) => [entry.code, entry.entity])
  );

  const dataScopeConditionByCode = new Map<string, ResolvedCondition>();
  dataScopePolicies.forEach((policy) => {
    if (!policy) return;
    const condition = policy.conditionTree
      ? interpolate(compile(policy.conditionTree.unpack()), subject)
      : emptyResolvedCondition();
    dataScopeConditionByCode.set(policy.code, condition);
  });

  const fieldScopeByCode = new Map<
    string,
    { fields: string[]; condition: ResolvedCondition | null }
  >();
  fieldScopePolicies.forEach((policy) => {
    if (!policy) return;
    const { conditionTree } = policy;
    fieldScopeByCode.set(policy.code, {
      fields: policy.fields,
      condition: conditionTree ? interpolate(compile(conditionTree.unpack()), subject) : null
    });
  });

  const resolvedGrants: ResolvedPermissionGrant[] = allGrants.map((grant) => {
    const entity = entityByPermissionCode.get(grant.permissionCode);
    if (!entity) {
      throw new ArgumentInvalidException(
        `Permission "${grant.permissionCode}" không có trong catalog`
      );
    }
    const dataScopeCondition = dataScopeConditionByCode.get(grant.dataScopePolicyCode);
    if (!dataScopeCondition) {
      throw new ArgumentInvalidException(
        `Data Scope Policy "${grant.dataScopePolicyCode}" không tồn tại`
      );
    }
    const fieldScope = grant.fieldScopePolicyCode
      ? fieldScopeByCode.get(grant.fieldScopePolicyCode)
      : null;
    if (grant.fieldScopePolicyCode && !fieldScope) {
      throw new ArgumentInvalidException(
        `Field Scope Policy "${grant.fieldScopePolicyCode}" không tồn tại`
      );
    }

    return {
      permissionCode: grant.permissionCode,
      entity,
      dataScopeCondition,
      fieldScopeFields: fieldScope?.fields ?? null,
      fieldScopeCondition: fieldScope?.condition ?? null
    };
  });

  const resolvedOverrides: ResolvedOverride[] = overrides.map((override) => {
    const entity = entityByPermissionCode.get(override.permissionCode);
    if (!entity) {
      throw new ArgumentInvalidException(
        `Permission "${override.permissionCode}" không có trong catalog`
      );
    }

    const dataScopeCondition = override.dataScopePolicyCode
      ? (dataScopeConditionByCode.get(override.dataScopePolicyCode) ?? null)
      : null;
    if (override.dataScopePolicyCode && !dataScopeCondition) {
      throw new ArgumentInvalidException(
        `Data Scope Policy "${override.dataScopePolicyCode}" không tồn tại`
      );
    }
    const fieldScope = override.fieldScopePolicyCode
      ? fieldScopeByCode.get(override.fieldScopePolicyCode)
      : null;
    if (override.fieldScopePolicyCode && !fieldScope) {
      throw new ArgumentInvalidException(
        `Field Scope Policy "${override.fieldScopePolicyCode}" không tồn tại`
      );
    }

    return {
      permissionCode: override.permissionCode,
      entity,
      status: override.status,
      dataScopeCondition,
      fieldScopeFields: fieldScope?.fields ?? null,
      fieldScopeCondition: fieldScope?.condition ?? null
    };
  });

  return buildRawRules({ grants: resolvedGrants, overrides: resolvedOverrides });
}

export async function resolveEffectiveAbility(employeeId: string): Promise<Ability> {
  const rawRules = await resolveEffectiveRules(employeeId);
  return buildAbility(rawRules);
}
