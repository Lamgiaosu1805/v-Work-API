import DepartmentModel from "../../models/DepartmentModel";
import { Ability, canOnSubject } from "../../modules/permission";

// Cây đơn vị (Khối → Chi nhánh → TTKD) + phạm vi xem của người hỏi — dùng chung cho bảng tổng hợp và xu hướng.

export const NO_UNIT_ID = "__no_unit__";
export const UNASSIGNED_ID = "__unassigned__";

const PSEUDO_UNITS: Record<string, { kind: string; name: string }> = {
  [UNASSIGNED_ID]: { kind: "unassigned", name: "Chưa phân bổ" },
  [NO_UNIT_ID]: { kind: "no_unit", name: "Chưa gán TTKD" }
};

export interface UnitRow {
  employeeId: string | null;
  departmentId: string | null;
}

export interface UnitInfo {
  id: string;
  kind: string;
  name: string;
  code: string | null;
  type: string | null;
  parent_id: string | null;
  manager_name: string | null;
}

export interface UnitTree {
  /** Đơn vị của 1 dòng số: TTKD (nếu còn tồn tại) / "Chưa gán TTKD" / "Chưa phân bổ" (không có Sale). */
  unitKeyOf(row: UnitRow): string;
  /** Đơn vị + mọi cấp cha để cộng dồn. */
  chainOf(unitKey: string): string[];
  /** Thông tin hiển thị; parent_id chỉ giữ khi cha cũng có mặt trong tập đơn vị trả về. */
  describe(unitId: string, includedIds: Set<string>): UnitInfo;
}

export async function loadUnitTree(): Promise<UnitTree> {
  const departments = (await DepartmentModel.find({ isDeleted: false })
    .select("department_name department_code type parent manager")
    .populate("manager", "full_name")
    .lean()) as any[];
  const deptById = new Map(departments.map((d) => [String(d._id), d]));

  const ancestorsOf = (deptId: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = deptById.get(deptId);
    while (current && !seen.has(String(current._id))) {
      seen.add(String(current._id));
      chain.push(String(current._id));
      current = current.parent ? deptById.get(String(current.parent)) : undefined;
    }
    return chain;
  };

  return {
    unitKeyOf: (row) => {
      if (!row.employeeId) return UNASSIGNED_ID;
      return row.departmentId && deptById.has(row.departmentId) ? row.departmentId : NO_UNIT_ID;
    },
    chainOf: (unitKey) => (PSEUDO_UNITS[unitKey] ? [unitKey] : ancestorsOf(unitKey)),
    describe: (unitId, includedIds) => {
      const dept = deptById.get(unitId);
      return {
        id: unitId,
        kind: dept ? "department" : PSEUDO_UNITS[unitId].kind,
        name: dept ? dept.department_name : PSEUDO_UNITS[unitId].name,
        code: dept?.department_code ?? null,
        type: dept?.type ?? null,
        parent_id:
          dept?.parent && includedIds.has(String(dept.parent)) ? String(dept.parent) : null,
        manager_name: dept?.manager?.full_name ?? null
      };
    }
  };
}

/** Phạm vi theo data scope của `daily_report.view`: toàn công ty (thấy cả "Chưa phân bổ") hay từng Sale. */
export function viewerScope(ability: Ability): {
  companyWide: boolean;
  canSee(employeeId: string): boolean;
} {
  // Quy tắc từ RBAC luôn mang `conditions: {}` (vd 2 role cùng "Toàn công ty" → truy vấn {$or:[{},{}]}),
  // nên xét trực tiếp quy tắc: có quy tắc cho phép không điều kiện và không có quy tắc chặn
  const rules = ability.rulesFor("daily_report.view", "DailyReport");
  const companyWide =
    rules.some((rule) => !rule.inverted && Object.keys(rule.conditions ?? {}).length === 0) &&
    !rules.some((rule) => rule.inverted);
  return {
    companyWide,
    canSee: (employeeId) =>
      companyWide ||
      canOnSubject(ability, "daily_report.view", "DailyReport", { employee_id: employeeId })
  };
}
