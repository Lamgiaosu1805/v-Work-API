import PermissionRoleModel from "../../../models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../../../models/EmployeePermissionProfileModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";

export interface RoleDeletionImpact {
  roleId: string;
  roleName: string;
  affectedEmployeeCount: number;
  affectedEmployeeIds: string[];
}

export async function getRoleDeletionImpact(roleId: string): Promise<RoleDeletionImpact> {
  const role = await PermissionRoleModel.findOne({ _id: roleId, isDeleted: false }).lean();
  if (!role) throw new NotFoundException("Không tìm thấy vai trò", { metadata: { roleId } });

  const profiles = await EmployeePermissionProfileModel.find({
    roleIds: roleId,
    isDeleted: false
  })
    .select("employeeId")
    .lean();

  const affectedEmployeeIds = profiles.map((profile) => String(profile.employeeId));

  return {
    roleId,
    roleName: role.name,
    affectedEmployeeCount: affectedEmployeeIds.length,
    affectedEmployeeIds
  };
}
