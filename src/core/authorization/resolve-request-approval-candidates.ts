import { subject as caslSubject } from "@casl/ability";
import PermissionRoleModel from "../../models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../../models/EmployeePermissionProfileModel";
import UserInfoModel from "../../models/UserInfoModel";
import UserDepartmentPositionModel from "../../models/UserDepartmentPositionModel";
import { resolveEffectiveRules, buildAbility, toMongoQuery } from "../../modules/permission";

function isUnconditioned(filter: Record<string, unknown>): boolean {
  const orBranches = (filter as { $or?: unknown[] }).$or;
  if (Array.isArray(orBranches)) {
    return orBranches.some(
      (branch) => branch && typeof branch === "object" && Object.keys(branch).length === 0
    );
  }
  return Object.keys(filter).length === 0;
}

export interface RequestApprovalCandidate {
  userInfoId: string;
  accountId: string;
  full_name: string;
  position_name: string | null;
  department_name: string | null;
}

export async function resolveRequestApprovalCandidates(
  targetEmployeeId: string
): Promise<RequestApprovalCandidate[]> {
  const roles = await PermissionRoleModel.find(
    { "grants.permissionCode": "request.review", isDeleted: false },
    { _id: 1 }
  ).lean();
  const roleIds = roles.map((role: any) => role._id);
  if (!roleIds.length) return [];

  const profiles = await EmployeePermissionProfileModel.find(
    { roleIds: { $in: roleIds }, isDeleted: false, employeeId: { $ne: targetEmployeeId } },
    { employeeId: 1 }
  ).lean();
  if (!profiles.length) return [];

  const candidateIds = Array.from(
    new Set(profiles.map((profile: any) => String(profile.employeeId)))
  );

  const targetDepartmentIds = new Set(
    (
      await UserDepartmentPositionModel.find({
        user: targetEmployeeId,
        isDeleted: false
      }).distinct("department")
    ).map(String)
  );

  const evaluated = await Promise.all(
    candidateIds.map(async (candidateId) => {
      const rawRules = await resolveEffectiveRules(candidateId);
      const ability = buildAbility(rawRules);
      const allowed = ability.can(
        "request.review",
        caslSubject("Request", { user_id: targetEmployeeId })
      );
      if (!allowed) return null;
      const scopeFilter = toMongoQuery(ability, "request.review", "Request");
      const isCompanyWide = isUnconditioned(scopeFilter);
      return { candidateId, isCompanyWide };
    })
  );
  const approved = evaluated.filter(
    (entry): entry is { candidateId: string; isCompanyWide: boolean } => entry !== null
  );
  if (!approved.length) return [];

  const approvedIds = approved.map((entry) => entry.candidateId);
  const [userInfos, memberships] = await Promise.all([
    UserInfoModel.find({ _id: { $in: approvedIds } }, { full_name: 1, id_account: 1 }).lean(),
    UserDepartmentPositionModel.find({ user: { $in: approvedIds }, isDeleted: false })
      .populate("position", "position_name")
      .populate("department", "department_name")
      .lean()
  ]);

  const membershipByUser = new Map<string, any>();
  const departmentIdsByUser = new Map<string, Set<string>>();
  memberships.forEach((membership: any) => {
    const userId = String(membership.user);
    if (!membershipByUser.has(userId)) membershipByUser.set(userId, membership);
    if (!departmentIdsByUser.has(userId)) departmentIdsByUser.set(userId, new Set());
    departmentIdsByUser.get(userId)!.add(String(membership.department?._id ?? membership.department));
  });
  const infoByCandidate = new Map(approved.map((entry) => [entry.candidateId, entry]));

  function rankOf(candidateId: string, isCompanyWide: boolean): number {
    const candidateDepartmentIds = departmentIdsByUser.get(candidateId) ?? new Set();
    for (const deptId of candidateDepartmentIds) {
      if (targetDepartmentIds.has(deptId)) return 0;
    }
    return isCompanyWide ? 2 : 1;
  }

  return userInfos
    .map((info: any) => {
      const candidateId = String(info._id);
      const membership = membershipByUser.get(candidateId);
      const entry = infoByCandidate.get(candidateId);
      return {
        userInfoId: candidateId,
        accountId: String(info.id_account),
        full_name: info.full_name,
        position_name: membership?.position?.position_name ?? null,
        department_name: membership?.department?.department_name ?? null,
        rank: rankOf(candidateId, entry?.isCompanyWide ?? true)
      };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.full_name.localeCompare(b.full_name);
    })
    .map(({ rank, ...candidate }) => candidate);
}
