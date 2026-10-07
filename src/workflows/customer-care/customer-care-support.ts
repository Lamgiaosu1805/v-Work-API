// Hỗ trợ cho các workflow customer-care: ghi Sale phụ trách vào Customer (model code cũ), log lịch sử,
// gửi thông báo, lọc Sale đủ điều kiện nhận khách. Được phép đọc/ghi model cũ ở tầng workflow.
import CustomerModel from "../../models/CustomerModel";
import CustomerInteractionModel from "../../models/CustomerInteractionModel";
import UserInfoModel from "../../models/UserInfoModel";
import { logger } from "../../config/logger";
import { listEmployeesByRoleCodes } from "../../modules/permission";
import { CRM_SALE_ROLE_CODES } from "../crm-sale-roles.constants";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationService = require("../../services/notificationService");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LeaveRequest } = require("../../models/RequestModel");

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface SaleBrief {
  _id: string;
  full_name: string;
  ma_nv: string;
  phone_number: string;
  id_account: string | null;
  direct_manager: string | null;
}

export async function loadSaleBriefs(saleIds: string[]): Promise<Map<string, SaleBrief>> {
  const rows = (await UserInfoModel.find({ _id: { $in: saleIds } })
    .select("full_name ma_nv phone_number id_account direct_manager")
    .lean()) as any[];
  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        _id: String(row._id),
        full_name: row.full_name,
        ma_nv: row.ma_nv,
        phone_number: row.phone_number,
        id_account: row.id_account ? String(row.id_account) : null,
        direct_manager: row.direct_manager ? String(row.direct_manager) : null
      }
    ])
  );
}

export const saleLabel = (sale: SaleBrief | undefined, fallback: string) =>
  sale ? `${sale.full_name} (${sale.ma_nv})` : fallback;

/**
 * Ghi Sale phụ trách hiện tại lên Customer. Theo quyết định "hoa hồng theo người đang giữ": KHÔNG
 * động tới hoa hồng đã phát sinh và KHÔNG đổi `source_type` (nguồn gốc khách). Phải gọi trong
 * transaction của caller (dùng `session`).
 */
export async function setCustomerOwner(input: {
  customerId: string;
  sale: SaleBrief | null;
  session: unknown;
  logContent: string;
  logType: "note" | "reassigned";
  metadata: Record<string, unknown>;
}): Promise<void> {
  const customer = (await CustomerModel.findById(input.customerId)
    .select("app_id")
    .session(input.session as never)
    .lean()) as any;
  if (!customer) return;

  const update = input.sale
    ? {
        referred_by: input.sale._id,
        ref_code: `${input.sale.phone_number}-${input.sale.ma_nv}`,
        referred_at: new Date()
      }
    : { referred_by: null, ref_code: null, referred_at: null };
  await CustomerModel.updateOne(
    { _id: input.customerId },
    { $set: update },
    { session: input.session as never }
  );
  await CustomerInteractionModel.create(
    [
      {
        app_id: customer.app_id,
        customer_id: input.customerId,
        sale_id: input.sale?._id ?? input.metadata.removed_sale_id ?? null,
        agent_id: null,
        type: input.logType,
        content: input.logContent,
        result: null,
        metadata: input.metadata
      }
    ],
    { session: input.session as never }
  );
}

export async function notifySale(input: {
  sale: SaleBrief | undefined;
  alsoManager?: boolean;
  title: string;
  body: string;
  type: string;
  customerId: string;
  managerTitle?: string;
}): Promise<void> {
  if (!input.sale) return;
  const targets: { accountId: string; title: string }[] = [];
  if (input.sale.id_account) targets.push({ accountId: input.sale.id_account, title: input.title });
  if (input.alsoManager && input.sale.direct_manager) {
    const managers = await loadSaleBriefs([input.sale.direct_manager]);
    const manager = managers.get(input.sale.direct_manager);
    if (manager?.id_account) {
      targets.push({ accountId: manager.id_account, title: input.managerTitle ?? input.title });
    }
  }
  await Promise.all(
    targets.map((target) =>
      notificationService
        .createNotification({
          account_id: target.accountId,
          title: target.title,
          body: input.body,
          type: input.type,
          ref_id: input.customerId,
          ref_type: "customer",
          uri: "/crm/khach-can-xu-ly",
          data: { customerId: input.customerId }
        })
        .catch((error: unknown) =>
          logger.error("Không gửi được thông báo chăm sóc khách", { error, type: input.type })
        )
    )
  );
}

export async function getCustomerLabel(customerId: string): Promise<string> {
  const customer = (await CustomerModel.findById(customerId)
    .select("phone_number identity.full_name")
    .lean()) as any;
  if (!customer) return "khách hàng";
  return customer.identity?.full_name
    ? `${customer.identity.full_name} (${customer.phone_number})`
    : customer.phone_number;
}

/** Sale đang nghỉ phép (đơn đã duyệt) tại thời điểm `now`, có xét buổi sáng/chiều. */
export async function findSalesOnLeave(saleIds: string[], now: Date): Promise<Set<string>> {
  if (!saleIds.length) return new Set();
  const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
  const todayKey = vnNow.toISOString().slice(0, 10);
  const isAfternoon = vnNow.getUTCHours() >= 12;
  const dayStart = new Date(`${todayKey}T00:00:00+07:00`);
  const dayEnd = new Date(`${todayKey}T23:59:59+07:00`);

  const leaves = (await LeaveRequest.find({
    status: "approved",
    isDeleted: { $ne: true },
    user_id: { $in: saleIds },
    from_date: { $lte: dayEnd },
    to_date: { $gte: dayStart }
  })
    .select("user_id from_date from_period to_date to_period")
    .lean()) as any[];

  const keyOf = (date: Date) =>
    new Date(new Date(date).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
  const onLeave = new Set<string>();
  leaves.forEach((leave) => {
    const startsToday = keyOf(leave.from_date) === todayKey;
    const endsToday = keyOf(leave.to_date) === todayKey;
    if (startsToday && leave.from_period === "afternoon" && !isAfternoon) return;
    if (endsToday && leave.to_period === "morning" && isAfternoon) return;
    onLeave.add(String(leave.user_id));
  });
  return onLeave;
}

/**
 * Sale đủ điều kiện được phân khách: có role CRM sale/trưởng nhóm, account còn hoạt động, chưa nghỉ
 * việc, không nghỉ phép lúc này. Trạng thái tạm dừng/khoá + hạn mức do module customer-care tự xét.
 */
export async function listEligibleSaleIds(now: Date): Promise<string[]> {
  const employees = await listEmployeesByRoleCodes(CRM_SALE_ROLE_CODES);
  const activeIds = Array.from(
    new Set(employees.filter((e) => !e.accountIsDeleted).map((e) => e.employeeId))
  );
  if (!activeIds.length) return [];
  const userInfos = (await UserInfoModel.find({ _id: { $in: activeIds }, isDeleted: { $ne: true } })
    .select("resignation_date")
    .lean()) as any[];
  const working = userInfos
    .filter((u) => !u.resignation_date || new Date(u.resignation_date).getTime() > now.getTime())
    .map((u) => String(u._id));
  const onLeave = await findSalesOnLeave(working, now);
  return working.filter((id) => !onLeave.has(id));
}
