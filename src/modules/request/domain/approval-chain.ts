import UserInfoModel from "../../../models/UserInfoModel";
import AccountModel from "../../../models/AccountModel";
import DepartmentModel from "../../../models/DepartmentModel";
import UserDepartmentPositionModel from "../../../models/UserDepartmentPositionModel";
import { can } from "../../../helpers/rbac";
import { PERMISSION } from "../../../constants";
import { ReviewerProfile } from "./types";

export interface ApprovalCandidate extends ReviewerProfile {
  accountId: unknown;
}

async function buildCandidate(userInfo: any, account: any): Promise<ApprovalCandidate | null> {
  if (!userInfo || !account) return null;

  const membership = await UserDepartmentPositionModel.findOne({
    user: userInfo._id,
    isDeleted: false
  })
    .populate("position", "position_name")
    .populate("department", "department_name");

  return {
    userInfoId: userInfo._id,
    accountId: account._id,
    full_name: userInfo.full_name,
    position_name: (membership?.position as { position_name?: string })?.position_name ?? null,
    department_name:
      (membership?.department as { department_name?: string })?.department_name ?? null
  };
}

async function resolveDepartmentHead(
  employeeUserInfoId: unknown
): Promise<ApprovalCandidate | null> {
  const membership = await UserDepartmentPositionModel.findOne({
    user: employeeUserInfoId,
    isDeleted: false
  });
  if (!membership) return null;

  const deptMemberIds = await UserDepartmentPositionModel.find({
    department: membership.department,
    isDeleted: false,
    user: { $ne: employeeUserInfoId }
  }).distinct("user");
  if (!deptMemberIds.length) return null;

  const userInfos = await UserInfoModel.find(
    { _id: { $in: deptMemberIds }, isDeleted: false },
    { full_name: 1, id_account: 1 }
  );
  if (!userInfos.length) return null;

  const accounts = await AccountModel.find({
    _id: { $in: userInfos.map((u: any) => u.id_account) },
    isDeleted: false
  }).sort({ createdAt: 1 });

  for (const account of accounts) {
    if (await can(account, PERMISSION.HRM_REQUEST_REVIEW)) {
      const userInfo = userInfos.find((u: any) => String(u.id_account) === String(account._id));
      return buildCandidate(userInfo, account);
    }
  }

  return null;
}

async function resolveIndirectManagerOrAdmin(
  employeeUserInfoId: unknown
): Promise<ApprovalCandidate | null> {
  const membership = await UserDepartmentPositionModel.findOne({
    user: employeeUserInfoId,
    isDeleted: false
  });

  if (membership) {
    const department = await DepartmentModel.findById(membership.department, { manager: 1 });
    if (department?.manager) {
      const managerInfo = await UserInfoModel.findOne({
        _id: department.manager,
        isDeleted: false
      });
      if (managerInfo) {
        const account = await AccountModel.findOne({
          _id: managerInfo.id_account,
          isDeleted: false
        });
        if (account) return buildCandidate(managerInfo, account);
      }
    }
  }

  const adminAccount = await AccountModel.findOne({ role: "admin", isDeleted: false }).sort({
    createdAt: 1
  });
  if (!adminAccount) return null;
  const adminUserInfo = await UserInfoModel.findOne({
    id_account: adminAccount._id,
    isDeleted: false
  });
  if (!adminUserInfo) return null;

  return buildCandidate(adminUserInfo, adminAccount);
}

export async function getApprovalChain(employeeUserInfoId: unknown): Promise<ApprovalCandidate[]> {
  const [level1, level2] = await Promise.all([
    resolveDepartmentHead(employeeUserInfoId),
    resolveIndirectManagerOrAdmin(employeeUserInfoId)
  ]);

  const seenAccounts = new Set<string>();
  return [level1, level2].filter((c): c is ApprovalCandidate => {
    if (!c) return false;
    if (String(c.userInfoId) === String(employeeUserInfoId)) return false;
    const key = String(c.accountId);
    if (seenAccounts.has(key)) return false;
    seenAccounts.add(key);
    return true;
  });
}

export async function getManagedUserIds(managerUserInfoId: unknown): Promise<unknown[]> {
  const manager: any = await UserInfoModel.findById(managerUserInfoId, {
    branch_id: 1,
    isDeleted: 1
  });
  if (!manager || manager.isDeleted) return [];

  const [ownDepts, managedDepts] = await Promise.all([
    UserDepartmentPositionModel.find({
      user: managerUserInfoId,
      isDeleted: false
    }).distinct("department"),
    DepartmentModel.find({ manager: managerUserInfoId, isDeleted: false }).distinct("_id")
  ]);
  const isTier2Manager = managedDepts.length > 0;
  const startDepts = [...new Set([...ownDepts, ...managedDepts].map(String))];
  if (!startDepts.length) return [];

  const seenDeptIds = new Set(startDepts);
  let frontier = startDepts;

  while (frontier.length) {
    const children = await DepartmentModel.find(
      { parent: { $in: frontier }, isDeleted: false },
      { _id: 1 }
    );
    const newIds = children.map((d: any) => String(d._id)).filter((id) => !seenDeptIds.has(id));
    if (!newIds.length) break;
    newIds.forEach((id) => seenDeptIds.add(id));
    frontier = newIds;
  }

  const members = await UserDepartmentPositionModel.find({
    department: { $in: [...seenDeptIds] },
    isDeleted: false,
    user: { $ne: managerUserInfoId }
  }).distinct("user");
  if (!members.length) return [];

  const employeeFilter: { _id: unknown; isDeleted: boolean; branch_id?: unknown } = {
    _id: { $in: members },
    isDeleted: false
  };
  if (!isTier2Manager) employeeFilter.branch_id = manager.branch_id;

  const employees = await UserInfoModel.find(employeeFilter, { _id: 1 });

  return employees.map((e: any) => e._id);
}
