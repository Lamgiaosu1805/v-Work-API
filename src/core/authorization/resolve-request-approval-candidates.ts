import AccountModel from "../../models/AccountModel";
import DepartmentModel from "../../models/DepartmentModel";
import UserDepartmentPositionModel from "../../models/UserDepartmentPositionModel";
import UserInfoModel from "../../models/UserInfoModel";

export type RequestApprovalSource = "direct_manager" | "branch_leader" | "admin";

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

async function resolveFallbackAdmin(
  targetEmployeeId: unknown
): Promise<RequestApprovalCandidate | null> {
  const admin: any = await AccountModel.findOne({ role: "admin", isDeleted: false })
    .sort({ createdAt: 1 })
    .lean();
  if (!admin) return null;
  const userInfo: any = await UserInfoModel.findOne({
    id_account: admin._id,
    isDeleted: false,
    _id: { $ne: targetEmployeeId }
  }).lean();
  return userInfo ? buildCandidate(userInfo._id, "admin") : null;
}

async function resolveConfiguredManager(
  userInfoId: unknown
): Promise<RequestApprovalCandidate | null> {
  return (await resolveDirectManager(userInfoId)) ?? resolveDepartmentManager(userInfoId);
}

export async function resolveRequestApprovalCandidates(
  targetEmployeeId: string
): Promise<RequestApprovalCandidate[]> {
  const level1 = await resolveConfiguredManager(targetEmployeeId);
  if (!level1) {
    const fallback = await resolveFallbackAdmin(targetEmployeeId);
    return fallback ? [fallback] : [];
  }

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
