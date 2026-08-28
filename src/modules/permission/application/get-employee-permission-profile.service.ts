import UserInfoModel from "../../../models/UserInfoModel";
import EmployeePermissionProfileModel from "../../../models/EmployeePermissionProfileModel";
import PermissionRoleModel from "../../../models/PermissionRoleModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";

export interface EmployeePermissionProfileView {
  employeeId: string;
  fullName: string;
  assignedRoles: { id: string; name: string; code: string }[];
  overrides: {
    permissionCode: string;
    status: "ALLOW" | "BLOCK";
    dataScopePolicyCode: string | null;
    fieldScopePolicyCode: string | null;
  }[];
}

export async function getEmployeePermissionProfile(
  employeeId: string
): Promise<EmployeePermissionProfileView> {
  const userInfo = await UserInfoModel.findOne({ _id: employeeId, isDeleted: false }).lean();
  if (!userInfo) {
    throw new NotFoundException("Không tìm thấy nhân viên", { metadata: { employeeId } });
  }

  const profile = await EmployeePermissionProfileModel.findOne({
    employeeId,
    isDeleted: false
  }).lean();

  const roleIds = profile?.roleIds ?? [];
  const roles = roleIds.length
    ? await PermissionRoleModel.find({ _id: { $in: roleIds }, isDeleted: false }).lean()
    : [];

  return {
    employeeId,
    fullName: (userInfo as any).full_name,
    assignedRoles: roles.map((role: any) => ({
      id: String(role._id),
      name: role.name,
      code: role.code
    })),
    overrides: (profile?.overrides ?? []).map((override: any) => ({
      permissionCode: override.permissionCode,
      status: override.status,
      dataScopePolicyCode: override.dataScopePolicyCode ?? null,
      fieldScopePolicyCode: override.fieldScopePolicyCode ?? null
    }))
  };
}
