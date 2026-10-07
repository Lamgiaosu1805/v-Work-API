// Quét SLA chăm sóc khách: cảnh báo + tự thu hồi (Quy định 183A, Điều 7, 8). Chạy mỗi phút.
import { logger } from "../config/logger";
import { runInTransaction } from "../core/db/run-in-transaction";
import { invalidatePermissionCache } from "../core/authorization/invalidate-permission-cache";
import {
  DueSlaAction,
  endActiveAssignment,
  listDueSlaActions,
  markAssignmentWarned
} from "../modules/customer-care";
import {
  getCustomerLabel,
  loadSaleBriefs,
  notifySale,
  saleLabel,
  setCustomerOwner
} from "./customer-care/customer-care-support";

const REVOKE_TEXT: Record<"revoke_no_contact" | "revoke_inactive", string> = {
  revoke_no_contact: "không liên hệ lần đầu đúng SLA",
  revoke_inactive: "không có hoạt động chăm sóc hợp lệ quá thời hạn"
};

async function warn(
  action: DueSlaAction,
  now: Date,
  sales: Awaited<ReturnType<typeof loadSaleBriefs>>
): Promise<void> {
  const kind = action.action === "warn_no_contact" ? "no_contact" : "inactive";
  await markAssignmentWarned(action.assignmentId, kind, now);
  const sale = sales.get(action.saleId);
  const customerLabel = await getCustomerLabel(action.customerId);
  await notifySale({
    sale,
    alsoManager: true,
    title:
      kind === "no_contact"
        ? `Cảnh báo SLA: chưa liên hệ khách nhóm ${action.priorityClass}`
        : "Cảnh báo: khách chưa được chăm sóc hợp lệ",
    managerTitle: `Cảnh báo SLA của ${saleLabel(sale, action.saleId)}`,
    body:
      kind === "no_contact"
        ? `${customerLabel} chưa được liên hệ. Khách sẽ bị thu hồi nếu tiếp tục quá hạn.`
        : `${customerLabel} đã quá thời hạn không có hoạt động chăm sóc hợp lệ.`,
    type: "customer_care_sla_warning",
    customerId: action.customerId
  });
}

async function revoke(
  action: DueSlaAction,
  now: Date,
  sales: Awaited<ReturnType<typeof loadSaleBriefs>>
): Promise<void> {
  const reason = action.action === "revoke_no_contact" ? "revoked_no_contact" : "revoked_inactive";
  const reasonText = REVOKE_TEXT[action.action as "revoke_no_contact" | "revoke_inactive"];
  const sale = sales.get(action.saleId);

  const ended = await runInTransaction(async (session) => {
    const res = await endActiveAssignment({
      customerId: action.customerId,
      reason,
      at: now,
      endedBy: null,
      note: reasonText
    });
    await setCustomerOwner({
      customerId: action.customerId,
      sale: null,
      session,
      logType: "reassigned",
      logContent: `Hệ thống thu hồi khách từ ${saleLabel(sale, action.saleId)} do ${reasonText}. ${
        res.poolStatus === "nurturing"
          ? "Đã đủ số vòng Sale — chuyển CSKH nuôi dưỡng."
          : "Khách trở về kho chung để phân Sale khác."
      }`,
      metadata: { from_sale_id: action.saleId, removed_sale_id: action.saleId, reason }
    });
    return res;
  });

  await invalidatePermissionCache([action.saleId]);
  const customerLabel = await getCustomerLabel(action.customerId);
  await notifySale({
    sale,
    alsoManager: true,
    title: "Khách đã bị thu hồi",
    managerTitle: `Đã thu hồi khách của ${saleLabel(sale, action.saleId)}`,
    body: `${customerLabel} bị thu hồi do ${reasonText}.${
      ended.poolStatus === "nurturing" ? " Khách chuyển CSKH nuôi dưỡng." : ""
    }`,
    type: "customer_care_revoked",
    customerId: action.customerId
  });
}

export interface SweepRunResult {
  warned: number;
  revoked: number;
  failed: number;
}

export async function sweepCustomerCareSla(now: Date = new Date()): Promise<SweepRunResult> {
  const actions = await listDueSlaActions(now);
  const result: SweepRunResult = { warned: 0, revoked: 0, failed: 0 };
  if (!actions.length) return result;
  const sales = await loadSaleBriefs(Array.from(new Set(actions.map((a) => a.saleId))));

  for (const action of actions) {
    try {
      if (action.action === "warn_no_contact" || action.action === "warn_inactive") {
        await warn(action, now, sales);
        result.warned += 1;
      } else {
        await revoke(action, now, sales);
        result.revoked += 1;
      }
    } catch (error) {
      result.failed += 1;
      logger.error("Xử lý SLA chăm sóc khách thất bại", { error, action });
    }
  }
  return result;
}
