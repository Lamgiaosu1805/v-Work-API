import DepartmentModel from "../../models/DepartmentModel";
import UserDepartmentPositionModel from "../../models/UserDepartmentPositionModel";
import UserInfoModel from "../../models/UserInfoModel";

async function collectDepartmentTree(rootIds: unknown[]): Promise<string[]> {
  const seen = new Set(rootIds.map(String));
  let frontier = [...seen];
  while (frontier.length) {
    const children: any[] = await DepartmentModel.find(
      { parent: { $in: frontier }, isDeleted: false },
      { _id: 1 }
    ).lean();
    const next = children.map((item) => String(item._id)).filter((id) => !seen.has(id));
    if (!next.length) break;
    next.forEach((id) => seen.add(id));
    frontier = next;
  }
  return [...seen];
}

async function collectDirectScope(managerIds: string[]): Promise<string[]> {
  if (!managerIds.length) return [];
  const [directReports, managedDepartmentIds] = await Promise.all([
    UserInfoModel.find({ direct_manager: { $in: managerIds }, isDeleted: false }).distinct("_id"),
    DepartmentModel.find({ manager: { $in: managerIds }, isDeleted: false }).distinct("_id")
  ]);

  const departmentTreeIds = await collectDepartmentTree(managedDepartmentIds);
  const departmentMembers = departmentTreeIds.length
    ? await UserDepartmentPositionModel.find({
        department: { $in: departmentTreeIds },
        isDeleted: false
      }).distinct("user")
    : [];

  return [...new Set([...directReports, ...departmentMembers].map(String))];
}

// Phạm vi đơn mà một người xuất hiện trong chuỗi duyệt tối đa 2 cấp:
// - cấp 1: nhân viên gán trực tiếp hoặc thuộc phòng ban người đó quản lý;
// - cấp 2: phạm vi cấp 1 của những người mà họ trực tiếp quản lý.
export async function resolveManagedRequestEmployeeIds(
  managerEmployeeId: string
): Promise<string[]> {
  const level1 = await collectDirectScope([managerEmployeeId]);
  const level2 = await collectDirectScope(level1);
  const seen = new Set([managerEmployeeId]);
  return [...level1, ...level2].filter((employeeId) => {
    if (seen.has(employeeId)) return false;
    seen.add(employeeId);
    return true;
  });
}
