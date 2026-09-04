import UserInfoModel from "../../../models/UserInfoModel";
import AccountModel from "../../../models/AccountModel";
import EmployeePermissionProfileModel from "../../../models/EmployeePermissionProfileModel";
import PermissionRoleModel from "../../../models/PermissionRoleModel";

export interface EmployeeByRoleItem {
  employeeId: string;
  fullName: string;
  email: string | null;
  username: string;
  accountId: string;
  accountIsDeleted: boolean;
  roleId: string;
  roleCode: string;
  roleName: string;
}

export async function listEmployeesByRoleCodes(roleCodes: string[]): Promise<EmployeeByRoleItem[]> {
  const roles = await PermissionRoleModel.find({
    code: { $in: roleCodes },
    isDeleted: false
  }).lean();
  if (roles.length === 0) return [];

  const roleIds = roles.map((role: any) => role._id);
  const roleById = new Map(roles.map((role: any) => [String(role._id), role]));

  const profiles = await EmployeePermissionProfileModel.find({
    roleIds: { $in: roleIds },
    isDeleted: false
  }).lean();
  if (profiles.length === 0) return [];

  const employeeIds = profiles.map((profile: any) => profile.employeeId);
  const userInfos = await UserInfoModel.find({
    _id: { $in: employeeIds },
    isDeleted: false
  }).lean();
  const userInfoById = new Map(userInfos.map((userInfo: any) => [String(userInfo._id), userInfo]));

  const accountIds = userInfos.map((userInfo: any) => userInfo.id_account);
  const accounts = await AccountModel.find({ _id: { $in: accountIds } }).lean();
  const accountById = new Map(accounts.map((account: any) => [String(account._id), account]));

  const items: EmployeeByRoleItem[] = [];
  profiles.forEach((profile: any) => {
    const userInfo = userInfoById.get(String(profile.employeeId));
    if (!userInfo) return;

    const matchedRoleId = (profile.roleIds ?? [])
      .map((id: any) => String(id))
      .find((id: string) => roleById.has(id));
    if (!matchedRoleId) return;

    const role = roleById.get(matchedRoleId)!;
    const account = accountById.get(String(userInfo.id_account));

    items.push({
      employeeId: String(profile.employeeId),
      fullName: userInfo.full_name,
      email: userInfo.email ?? null,
      username: account?.username ?? "",
      accountId: account ? String(account._id) : "",
      accountIsDeleted: account?.isDeleted ?? false,
      roleId: matchedRoleId,
      roleCode: role.code,
      roleName: role.name
    });
  });

  return items;
}
