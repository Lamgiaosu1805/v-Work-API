import PermissionRoleModel from "../../../models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../../../models/EmployeePermissionProfileModel";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";

interface ListRolesQuery extends PaginationQuery {
  search?: string;
}

export interface RoleListItem {
  id: string;
  name: string;
  code: string;
  description: string;
  isSystemRole: boolean;
  employeeCount: number;
}

export interface ListRolesResult {
  data: RoleListItem[];
  total: number;
  page: number;
  limit: number;
}

export async function listRoles(query: ListRolesQuery = {}): Promise<ListRolesResult> {
  const { search } = query;
  const { page, limit, skip } = parsePagination(query);

  const filter: Record<string, unknown> = { isDeleted: false };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { code: { $regex: search, $options: "i" } }
    ];
  }

  const [docs, total] = await Promise.all([
    PermissionRoleModel.find(filter).skip(skip).limit(limit).lean(),
    PermissionRoleModel.countDocuments(filter)
  ]);

  const roleIds = docs.map((doc) => doc._id);
  const counts = await EmployeePermissionProfileModel.aggregate([
    { $match: { isDeleted: false, roleIds: { $in: roleIds } } },
    { $unwind: "$roleIds" },
    { $match: { roleIds: { $in: roleIds } } },
    { $group: { _id: "$roleIds", count: { $sum: 1 } } }
  ]);
  const countByRoleId = new Map<string, number>(
    counts.map((row: any) => [String(row._id), row.count])
  );

  const data: RoleListItem[] = docs.map((doc: any) => ({
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    description: doc.description,
    isSystemRole: doc.isSystemRole,
    employeeCount: countByRoleId.get(String(doc._id)) ?? 0
  }));

  return { data, total, page, limit };
}
