import DepartmentModel from "../../../models/DepartmentModel";
import UserDepartmentPositionModel from "../../../models/UserDepartmentPositionModel";
import UserInfoModel from "../../../models/UserInfoModel";
import { resolveEmployeeId } from "../../../core/authorization/resolve-employee-id";
import { DepartmentSummary, EmployeeSummary, TicketDirectory } from "../application/ports";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface DepartmentRow {
  _id: unknown;
  department_name: string;
  parent: unknown;
  manager: unknown;
}

async function loadDepartments(): Promise<DepartmentRow[]> {
  return (await DepartmentModel.find({ isDeleted: false })
    .select("department_name parent manager")
    .lean()) as unknown as DepartmentRow[];
}

function collectTree(rootIds: string[], departments: DepartmentRow[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  departments.forEach((department) => {
    if (!department.parent) return;
    const parentId = String(department.parent);
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), String(department._id)]);
  });

  const seen = new Set(rootIds);
  let frontier = [...rootIds];
  while (frontier.length) {
    const next = frontier.flatMap((id) => childrenOf.get(id) ?? []).filter((id) => !seen.has(id));
    next.forEach((id) => seen.add(id));
    frontier = next;
  }
  return seen;
}

async function toEmployeeSummaries(userInfos: any[]): Promise<EmployeeSummary[]> {
  if (!userInfos.length) return [];
  const memberships = (await UserDepartmentPositionModel.find({
    user: { $in: userInfos.map((user) => user._id) },
    isDeleted: false
  })
    .populate("department", "department_name")
    .lean()) as any[];

  const namesByUser = new Map<string, string[]>();
  memberships.forEach((membership) => {
    const name = membership.department?.department_name;
    if (!name) return;
    const key = String(membership.user);
    namesByUser.set(key, [...(namesByUser.get(key) ?? []), name]);
  });

  return userInfos.map((user) => ({
    id: String(user._id),
    fullName: user.full_name,
    accountId: user.id_account ? String(user.id_account) : null,
    departmentNames: namesByUser.get(String(user._id)) ?? []
  }));
}

export class MongooseTicketDirectory implements TicketDirectory {
  // eslint-disable-next-line class-methods-use-this
  async resolveEmployeeId(accountId: string): Promise<string> {
    return resolveEmployeeId(accountId);
  }

  // eslint-disable-next-line class-methods-use-this
  async getDepartmentIdsWithAncestors(employeeId: string): Promise<string[]> {
    const [memberships, departments] = await Promise.all([
      UserDepartmentPositionModel.find({ user: employeeId, isDeleted: false })
        .select("department")
        .lean() as unknown as Promise<Array<{ department: unknown }>>,
      loadDepartments()
    ]);
    const parentOf = new Map(
      departments.map((department) => [String(department._id), department.parent])
    );

    const result = new Set<string>();
    memberships.forEach(({ department }) => {
      let current: string | null = department ? String(department) : null;
      while (current && !result.has(current)) {
        result.add(current);
        const parent = parentOf.get(current);
        current = parent ? String(parent) : null;
      }
    });
    return [...result];
  }

  // eslint-disable-next-line class-methods-use-this
  async getOwnDepartmentTreeEmployeeIds(employeeId: string): Promise<string[]> {
    const [memberships, departments] = await Promise.all([
      UserDepartmentPositionModel.find({ user: employeeId, isDeleted: false })
        .select("department")
        .lean() as unknown as Promise<Array<{ department: unknown }>>,
      loadDepartments()
    ]);
    const roots = new Set<string>(memberships.map(({ department }) => String(department)));
    departments
      .filter((department) => department.manager && String(department.manager) === employeeId)
      .forEach((department) => roots.add(String(department._id)));
    if (!roots.size) return [];

    const tree = collectTree([...roots], departments);
    const members = await UserDepartmentPositionModel.find({
      department: { $in: [...tree] },
      isDeleted: false
    }).distinct("user");
    return members.map(String);
  }

  // eslint-disable-next-line class-methods-use-this
  async getDepartmentMemberIds(departmentId: string): Promise<string[]> {
    const departments = await loadDepartments();
    const tree = collectTree([departmentId], departments);
    const members = await UserDepartmentPositionModel.find({
      department: { $in: [...tree] },
      isDeleted: false
    }).distinct("user");
    const active = await UserInfoModel.find({
      _id: { $in: members },
      isDeleted: false,
      resignation_date: null
    })
      .select("_id")
      .lean();
    return active.map((user: any) => String(user._id));
  }

  // eslint-disable-next-line class-methods-use-this
  async getEmployees(ids: string[]): Promise<EmployeeSummary[]> {
    if (!ids.length) return [];
    const userInfos = await UserInfoModel.find({ _id: { $in: ids }, isDeleted: false })
      .select("full_name id_account")
      .lean();
    return toEmployeeSummaries(userInfos);
  }

  // eslint-disable-next-line class-methods-use-this
  async getDepartments(ids: string[]): Promise<DepartmentSummary[]> {
    if (!ids.length) return [];
    const departments = (await DepartmentModel.find({ _id: { $in: ids }, isDeleted: false })
      .select("department_name manager")
      .lean()) as unknown as DepartmentRow[];
    return departments.map((department) => ({
      id: String(department._id),
      name: department.department_name,
      managerId: department.manager ? String(department.manager) : null
    }));
  }

  // eslint-disable-next-line class-methods-use-this
  async searchEmployees(
    query: string,
    limit: number,
    onlyIds?: string[]
  ): Promise<EmployeeSummary[]> {
    const filter: Record<string, unknown> = { isDeleted: false, resignation_date: null };
    // Giới hạn trong một tập người ngay ở câu truy vấn (không lọc sau khi đã cắt `limit`)
    if (onlyIds) filter._id = { $in: onlyIds };
    const keyword = query.trim();
    if (keyword) {
      const pattern = new RegExp(escapeRegex(keyword), "i");
      const conditions: Record<string, unknown>[] = [{ full_name: pattern }, { ma_nv: pattern }];
      // Gõ SĐT: so theo phần số, bỏ số 0 / +84 đầu để "0343..." khớp cả "+84343..." (và ngược lại).
      const digits = keyword.replace(/\D/g, "").replace(/^(84|0)/, "");
      if (/^[\d\s+().-]+$/.test(keyword) && digits.length >= 3) {
        conditions.push({ phone_number: new RegExp(escapeRegex(digits)) });
      }
      filter.$or = conditions;
    }
    const userInfos = await UserInfoModel.find(filter)
      .select("full_name id_account")
      .sort({ full_name: 1 })
      .limit(limit)
      .lean();
    return toEmployeeSummaries(userInfos);
  }

  // eslint-disable-next-line class-methods-use-this
  async listDepartments(): Promise<DepartmentSummary[]> {
    const departments = await loadDepartments();
    return departments
      .map((department) => ({
        id: String(department._id),
        name: department.department_name,
        managerId: department.manager ? String(department.manager) : null
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }
}
