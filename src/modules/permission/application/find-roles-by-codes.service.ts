import PermissionRoleModel from "../../../models/PermissionRoleModel";

export interface RoleByCodeItem {
  id: string;
  code: string;
  name: string;
}

export async function findRolesByCodes(codes: string[]): Promise<RoleByCodeItem[]> {
  if (codes.length === 0) return [];

  const roles = await PermissionRoleModel.find({
    code: { $in: codes },
    isDeleted: false
  }).lean();

  return roles.map((role) => ({
    id: String(role._id),
    code: role.code,
    name: role.name
  }));
}
