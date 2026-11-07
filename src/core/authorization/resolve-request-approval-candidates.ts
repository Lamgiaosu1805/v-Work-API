import { subject as caslSubject } from "@casl/ability";
import AccountModel from "../../models/AccountModel";
import DepartmentModel from "../../models/DepartmentModel";
import UserDepartmentPositionModel from "../../models/UserDepartmentPositionModel";
import UserInfoModel from "../../models/UserInfoModel";
import PermissionRoleModel from "../../models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../../models/EmployeePermissionProfileModel";
import { resolveEffectiveRules, buildAbility, toMongoQuery } from "../../modules/permission";

// direct_manager / branch_leader: quản lý theo sơ đồ tổ chức (user_info.direct_manager,
// department.manager). permission: người được gán quyền request.review (vai trò/override) có phạm vi
// bao trùm nhân viên này.
export type RequestApprovalSource = "direct_manager" | "branch_leader" | "permission";

export interface RequestApprovalCandidate {
  userInfoId: string;
  accountId: string;
  full_name: string;
  position_name: string | null;
  department_name: string | null;
  source: RequestApprovalSource;
}

async function buildCandidate(
  userInfoId: unknown,
  source: RequestApprovalSource
): Promise<RequestApprovalCandidate | null> {
  const userInfo: any = await UserInfoModel.findOne({ _id: userInfoId, isDeleted: false }).lean();
  if (!userInfo) return null;
  const account: any = await AccountModel.findOne({
    _id: userInfo.id_account,
    isDeleted: false
  }).lean();
  if (!account) return null;
  const membership: any = await UserDepartmentPositionModel.findOne({
    user: userInfo._id,
    isDeleted: false
  })
    .populate("position", "position_name")
    .populate("department", "department_name")
    .lean();

  return {
    userInfoId: String(userInfo._id),
    accountId: String(account._id),
    full_name: userInfo.full_name,
    position_name: membership?.position?.position_name ?? null,
    department_name: membership?.department?.department_name ?? null,
    source
  };
}

async function resolveDirectManager(userInfoId: unknown): Promise<RequestApprovalCandidate | null> {
  const userInfo: any = await UserInfoModel.findOne(
    { _id: userInfoId, isDeleted: false },
    { direct_manager: 1 }
  ).lean();
  if (!userInfo?.direct_manager || String(userInfo.direct_manager) === String(userInfoId)) {
    return null;
  }
  return buildCandidate(userInfo.direct_manager, "direct_manager");
}

async function resolveDepartmentManager(
  userInfoId: unknown
): Promise<RequestApprovalCandidate | null> {
  const membership: any = await UserDepartmentPositionModel.findOne({
    user: userInfoId,
    isDeleted: false
  }).lean();
  if (!membership) return null;

  const visited = new Set<string>();
  let departmentId: unknown = membership.department;
  while (departmentId && !visited.has(String(departmentId))) {
    visited.add(String(departmentId));
    const department: any = await DepartmentModel.findOne(
      { _id: departmentId, isDeleted: false },
      { manager: 1, parent: 1 }
    ).lean();
    if (!department) return null;
    if (department.manager && String(department.manager) !== String(userInfoId)) {
      const candidate = await buildCandidate(department.manager, "branch_leader");
      if (candidate) return candidate;
    }
    departmentId = department.parent;
  }
  return null;
}

async function resolveConfiguredManager(
  userInfoId: unknown
): Promise<RequestApprovalCandidate | null> {
  return (await resolveDirectManager(userInfoId)) ?? resolveDepartmentManager(userInfoId);
}

async function resolveOrgChartManagers(
  targetEmployeeId: string
): Promise<RequestApprovalCandidate[]> {
  const level1 = await resolveConfiguredManager(targetEmployeeId);
  if (!level1) return [];

  const level2Candidates = [
    await resolveDirectManager(level1.userInfoId),
    await resolveDepartmentManager(level1.userInfoId),
    await resolveDepartmentManager(targetEmployeeId)
  ];
  const level2 = level2Candidates.find(
    (candidate) =>
      candidate &&
      candidate.userInfoId !== targetEmployeeId &&
      candidate.accountId !== level1.accountId
  );

  return level2 ? [level1, level2] : [level1];
}

function isUnconditioned(filter: Record<string, unknown>): boolean {
  const orBranches = (filter as { $or?: unknown[] }).$or;
  if (Array.isArray(orBranches)) {
    return orBranches.some(
      (branch) => branch && typeof branch === "object" && Object.keys(branch).length === 0
    );
  }
  return Object.keys(filter).length === 0;
}

// Người được gán quyền request.review (qua vai trò hoặc override ALLOW) mà phạm vi bao trùm nhân viên
// này. Xếp: cùng phòng ban với nhân viên (0) > manager phòng của nhân viên hoặc phạm vi giới hạn (1) >
// phạm vi toàn công ty (2); cùng hạng thì theo tên.
async function resolvePermissionReviewers(
  targetEmployeeId: string
): Promise<RequestApprovalCandidate[]> {
  const roles = await PermissionRoleModel.find(
    { "grants.permissionCode": "request.review", isDeleted: false },
    { _id: 1 }
  ).lean();
  const roleIds = roles.map((role: any) => role._id);

  const [roleProfiles, overrideProfiles] = await Promise.all([
    roleIds.length
      ? EmployeePermissionProfileModel.find(
          { roleIds: { $in: roleIds }, isDeleted: false, employeeId: { $ne: targetEmployeeId } },
          { employeeId: 1 }
        ).lean()
      : Promise.resolve([]),
    EmployeePermissionProfileModel.find(
      {
        overrides: { $elemMatch: { permissionCode: "request.review", status: "ALLOW" } },
        isDeleted: false,
        employeeId: { $ne: targetEmployeeId }
      },
      { employeeId: 1 }
    ).lean()
  ]);

  const candidateIds = Array.from(
    new Set(
      [...roleProfiles, ...overrideProfiles].map((profile: any) => String(profile.employeeId))
    )
  );
  if (!candidateIds.length) return [];

  const targetDepartmentIds = new Set(
    (
      await UserDepartmentPositionModel.find({
        user: targetEmployeeId,
        isDeleted: false
      }).distinct("department")
    ).map(String)
  );
  const targetDepartments = await DepartmentModel.find(
    { _id: { $in: Array.from(targetDepartmentIds) }, isDeleted: false },
    { manager: 1 }
  ).lean();
  const departmentManagerIds = new Set(
    targetDepartments
      .map((department: any) => department.manager)
      .filter(Boolean)
      .map(String)
  );

  const evaluated = await Promise.all(
    candidateIds.map(async (candidateId) => {
      const ability = buildAbility(await resolveEffectiveRules(candidateId));
      const allowed = ability.can(
        "request.review",
        caslSubject("Request", { user_id: targetEmployeeId })
      );
      if (!allowed) return null;
      const isCompanyWide = isUnconditioned(toMongoQuery(ability, "request.review", "Request"));
      return { candidateId, isCompanyWide };
    })
  );
  const approved = evaluated.filter(
    (entry): entry is { candidateId: string; isCompanyWide: boolean } => entry !== null
  );
  if (!approved.length) return [];

  const approvedIds = approved.map((entry) => entry.candidateId);
  const [userInfos, memberships] = await Promise.all([
    UserInfoModel.find(
      { _id: { $in: approvedIds }, isDeleted: false },
      { full_name: 1, id_account: 1 }
    ).lean(),
    UserDepartmentPositionModel.find({ user: { $in: approvedIds }, isDeleted: false })
      .populate("position", "position_name")
      .populate("department", "department_name")
      .lean()
  ]);
  const activeAccountIds = new Set(
    (
      await AccountModel.find(
        { _id: { $in: userInfos.map((info: any) => info.id_account) }, isDeleted: false },
        { _id: 1 }
      ).lean()
    ).map((account: any) => String(account._id))
  );

  const membershipByUser = new Map<string, any>();
  const departmentIdsByUser = new Map<string, Set<string>>();
  memberships.forEach((membership: any) => {
    const userId = String(membership.user);
    if (!membershipByUser.has(userId)) membershipByUser.set(userId, membership);
    if (!departmentIdsByUser.has(userId)) departmentIdsByUser.set(userId, new Set());
    departmentIdsByUser
      .get(userId)!
      .add(String(membership.department?._id ?? membership.department));
  });
  const isCompanyWideById = new Map(
    approved.map((entry) => [entry.candidateId, entry.isCompanyWide])
  );

  function rankOf(candidateId: string): number {
    const candidateDepartmentIds = departmentIdsByUser.get(candidateId) ?? new Set();
    for (const deptId of candidateDepartmentIds) {
      if (targetDepartmentIds.has(deptId)) return 0;
    }
    if (departmentManagerIds.has(candidateId)) return 1;
    return isCompanyWideById.get(candidateId) ? 2 : 1;
  }

  return userInfos
    .filter((info: any) => activeAccountIds.has(String(info.id_account)))
    .map((info: any) => {
      const candidateId = String(info._id);
      const membership = membershipByUser.get(candidateId);
      return {
        userInfoId: candidateId,
        accountId: String(info.id_account),
        full_name: info.full_name,
        position_name: membership?.position?.position_name ?? null,
        department_name: membership?.department?.department_name ?? null,
        source: "permission" as const,
        rank: rankOf(candidateId)
      };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.full_name.localeCompare(b.full_name);
    })
    .map(({ rank, ...candidate }) => candidate);
}

// Những người duyệt được đơn của nhân viên, theo thứ tự gợi ý: quản lý theo sơ đồ tổ chức trước (cấp 1
// rồi cấp 2), sau đó tới người được gán quyền request.review có phạm vi bao trùm nhân viên. Đây chỉ là
// danh sách để hiển thị, gửi thông báo và đếm số người duyệt được — người duyệt KHÔNG bắt buộc phải nằm
// trong danh sách này (xem reviewRequestEntity: chỉ cần quyền request.review + đơn trong phạm vi).
export async function resolveRequestApprovalCandidates(
  targetEmployeeId: string
): Promise<RequestApprovalCandidate[]> {
  const [orgChartManagers, permissionReviewers] = await Promise.all([
    resolveOrgChartManagers(targetEmployeeId),
    resolvePermissionReviewers(targetEmployeeId)
  ]);
  const seen = new Set(orgChartManagers.map((candidate) => candidate.accountId));
  return [
    ...orgChartManagers,
    ...permissionReviewers.filter((candidate) => !seen.has(candidate.accountId))
  ];
}
