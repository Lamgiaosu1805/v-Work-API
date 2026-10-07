// Tổng quan nhận khách của từng Sale cho màn quản lý: trạng thái mở/tạm dừng/khoá, nghỉ phép, hạn mức
// theo hạng, số khách mới hôm nay / đang xử lý, trạng thái "Đủ" (Quy định 183A Điều 6, Phụ lục 01-B/C).
import { listEmployeesByRoleCodes, Ability, canOnSubject } from "../modules/permission";
import { buildSaleCapacityViews, requireCarePolicy } from "../modules/customer-care";
import UserInfoModel from "../models/UserInfoModel";
import { CRM_SALE_ROLE_CODES } from "./crm-sale-roles.constants";
import { findSalesOnLeave } from "./customer-care/customer-care-support";

type ReceivingState = "resigned" | "on_leave" | "paused" | "locked" | "open" | "full" | "receiving";

function receivingState(
  view: { accepting: boolean; isFull: boolean; status: "open" | "paused" | "locked" },
  onLeave: boolean,
  resigned: boolean
): ReceivingState {
  if (resigned) return "resigned";
  if (onLeave) return "on_leave";
  if (!view.accepting) return view.status;
  if (view.isFull) return "full";
  return "receiving";
}

export async function listSaleAllocationOverview(
  ability: Ability,
  appCode: string,
  now: Date = new Date()
) {
  const policy = await requireCarePolicy(appCode);
  const employees = (await listEmployeesByRoleCodes(CRM_SALE_ROLE_CODES)).filter(
    (e) =>
      !e.accountIsDeleted &&
      canOnSubject(ability, "customer_care.manage", "Customer", { referred_by: e.employeeId })
  );
  const saleIds = Array.from(new Set(employees.map((e) => e.employeeId)));
  const [views, onLeave, userInfos] = await Promise.all([
    buildSaleCapacityViews(saleIds, policy, now),
    findSalesOnLeave(saleIds, now),
    UserInfoModel.find({ _id: { $in: saleIds } })
      .select("full_name ma_nv resignation_date")
      .lean()
  ]);
  const infoById = new Map((userInfos as any[]).map((u) => [String(u._id), u]));
  const roleBySale = new Map(employees.map((e) => [e.employeeId, e.roleName]));

  return views.map((view) => {
    const info: any = infoById.get(view.saleId);
    const resigned =
      !!info?.resignation_date && new Date(info.resignation_date).getTime() <= now.getTime();
    const leave = onLeave.has(view.saleId);
    const receiving = view.accepting && !view.isFull && !leave && !resigned;
    return {
      sale_id: view.saleId,
      full_name: info?.full_name ?? null,
      ma_nv: info?.ma_nv ?? null,
      role_name: roleBySale.get(view.saleId) ?? null,
      rank: view.rank,
      allocation_status: view.status,
      reason: view.reason,
      until: view.until,
      on_leave: leave,
      resigned,
      cap_new_per_day: view.capNewPerDay,
      cap_total: view.capTotal,
      new_today: view.newToday,
      active_load: view.activeLoad,
      remaining_today: Math.max(
        0,
        Math.min(view.capNewPerDay - view.newToday, view.capTotal - view.activeLoad)
      ),
      is_full: view.isFull,
      receiving_state: receivingState(view, leave, resigned),
      receiving,
      last_assigned_at: view.lastAssignedAt
    };
  });
}
