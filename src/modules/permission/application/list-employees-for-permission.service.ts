import UserInfoModel from "../../../models/UserInfoModel";
import AccountModel from "../../../models/AccountModel";
import UserDepartmentPositionModel from "../../../models/UserDepartmentPositionModel";
import DepartmentModel from "../../../models/DepartmentModel";
import PositionModel from "../../../models/PositionModel";
import EmployeePermissionProfileModel from "../../../models/EmployeePermissionProfileModel";
import PermissionRoleModel from "../../../models/PermissionRoleModel";
import PermissionCatalogModel from "../../../models/PermissionCatalogModel";
import DataScopePolicyModel from "../../../models/DataScopePolicyModel";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";

interface ListEmployeesForPermissionQuery extends PaginationQuery {
  search?: string;
}

export interface EmployeePermissionListItem {
  employeeId: string;
  fullName: string;
  username: string;
  departmentNames: string[];
  positionNames: string[];
  roleNames: string[];
  assignedModuleNames: string[];
  assignedScopeLabels: string[];
}

export interface ListEmployeesForPermissionResult {
  data: EmployeePermissionListItem[];
  total: number;
  page: number;
  limit: number;
}

async function findMatchingEmployeeIds(search: string): Promise<string[]> {
  const regex = { $regex: search, $options: "i" };

  const [matchedAccounts, matchedDepartments, matchedPositions, matchedByName] = await Promise.all([
    AccountModel.find({ username: regex }).select("_id").lean(),
    DepartmentModel.find({ department_name: regex }).select("_id").lean(),
    PositionModel.find({ position_name: regex }).select("_id").lean(),
    UserInfoModel.find({ full_name: regex, isDeleted: false }).select("_id").lean()
  ]);

  const accountIds = matchedAccounts.map((account: any) => account._id);
  const deptIds = matchedDepartments.map((dept: any) => dept._id);
  const positionIds = matchedPositions.map((position: any) => position._id);

  const [byAccount, byDeptOrPosition] = await Promise.all([
    UserInfoModel.find({ id_account: { $in: accountIds }, isDeleted: false })
      .select("_id")
      .lean(),
    UserDepartmentPositionModel.find({
      isDeleted: false,
      $or: [{ department: { $in: deptIds } }, { position: { $in: positionIds } }]
    })
      .select("user")
      .lean()
  ]);

  const matchedIdSet = new Set<string>([
    ...matchedByName.map((user: any) => String(user._id)),
    ...byAccount.map((user: any) => String(user._id)),
    ...byDeptOrPosition.map((udp: any) => String(udp.user))
  ]);

  return Array.from(matchedIdSet);
}

export async function listEmployeesForPermission(
  query: ListEmployeesForPermissionQuery = {}
): Promise<ListEmployeesForPermissionResult> {
  const { search } = query;
  const { page, limit, skip } = parsePagination(query);

  const filter: Record<string, unknown> = { isDeleted: false };
  if (search) {
    filter._id = { $in: await findMatchingEmployeeIds(search) };
  }

  const [userInfos, total] = await Promise.all([
    UserInfoModel.find(filter).skip(skip).limit(limit).lean(),
    UserInfoModel.countDocuments(filter)
  ]);

  const userInfoIds = userInfos.map((userInfo: any) => userInfo._id);
  const accountIds = userInfos.map((userInfo: any) => userInfo.id_account);

  const [accounts, udps, profiles] = await Promise.all([
    AccountModel.find({ _id: { $in: accountIds } })
      .select("username")
      .lean(),
    UserDepartmentPositionModel.find({ user: { $in: userInfoIds }, isDeleted: false })
      .populate("department", "department_name")
      .populate("position", "position_name")
      .lean(),
    EmployeePermissionProfileModel.find({
      employeeId: { $in: userInfoIds },
      isDeleted: false
    }).lean()
  ]);

  const accountById = new Map(
    accounts.map((account: any) => [String(account._id), account.username])
  );

  const udpsByUser = new Map<string, any[]>();
  udps.forEach((udp: any) => {
    const key = String(udp.user);
    if (!udpsByUser.has(key)) udpsByUser.set(key, []);
    udpsByUser.get(key)!.push(udp);
  });

  const profileByEmployeeId = new Map(
    profiles.map((profile: any) => [String(profile.employeeId), profile])
  );

  const allRoleIds = Array.from(
    new Set(
      profiles.flatMap((profile: any) => (profile.roleIds ?? []).map((id: any) => String(id)))
    )
  );
  const roles = await PermissionRoleModel.find({ _id: { $in: allRoleIds } }).lean();
  const roleById = new Map(roles.map((role: any) => [String(role._id), role]));

  const allPermissionCodes = Array.from(
    new Set(
      roles.flatMap((role: any) => (role.grants ?? []).map((grant: any) => grant.permissionCode))
    )
  );
  const allDataScopeCodes = Array.from(
    new Set(
      roles.flatMap((role: any) =>
        (role.grants ?? []).map((grant: any) => grant.dataScopePolicyCode)
      )
    )
  );

  const [catalogEntries, scopePolicies] = await Promise.all([
    PermissionCatalogModel.find({ code: { $in: allPermissionCodes } }).lean(),
    DataScopePolicyModel.find({ code: { $in: allDataScopeCodes } }).lean()
  ]);
  const moduleByPermissionCode = new Map(
    catalogEntries.map((entry: any) => [entry.code, entry.module])
  );
  const scopeLabelByCode = new Map(scopePolicies.map((policy: any) => [policy.code, policy.label]));

  const data: EmployeePermissionListItem[] = userInfos.map((userInfo: any) => {
    const employeeId = String(userInfo._id);
    const udpList = udpsByUser.get(employeeId) ?? [];
    const profile = profileByEmployeeId.get(employeeId);
    const roleIds = (profile?.roleIds ?? []).map((id: any) => String(id));
    const employeeRoles = roleIds.map((id: string) => roleById.get(id)).filter(Boolean);

    const moduleNames = new Set<string>();
    const scopeLabels = new Set<string>();
    employeeRoles.forEach((role: any) => {
      (role.grants ?? []).forEach((grant: any) => {
        const moduleName = moduleByPermissionCode.get(grant.permissionCode);
        if (moduleName) moduleNames.add(moduleName);
        const scopeLabel = scopeLabelByCode.get(grant.dataScopePolicyCode);
        if (scopeLabel) scopeLabels.add(scopeLabel);
      });
    });

    return {
      employeeId,
      fullName: userInfo.full_name,
      username: accountById.get(String(userInfo.id_account)) ?? "",
      departmentNames: udpList.map((udp: any) => udp.department?.department_name).filter(Boolean),
      positionNames: udpList.map((udp: any) => udp.position?.position_name).filter(Boolean),
      roleNames: employeeRoles.map((role: any) => role.name),
      assignedModuleNames: Array.from(moduleNames),
      assignedScopeLabels: Array.from(scopeLabels)
    };
  });

  return { data, total, page, limit };
}
