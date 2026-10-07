// Phân khách trong Pool cho Sale đủ điều kiện (Quy định 183A, Điều 3-B2, 5, 6). Chạy mỗi phút.
import { logger } from "../config/logger";
import { runInTransaction } from "../core/db/run-in-transaction";
import { invalidatePermissionCache } from "../core/authorization/invalidate-permission-cache";
import { ConflictException } from "../core/exceptions/exceptions";
import {
  assignCustomerToSale,
  planPoolAllocation,
  PoolAllocationPlan
} from "../modules/customer-care";
import {
  getCustomerLabel,
  listEligibleSaleIds,
  loadSaleBriefs,
  notifySale,
  saleLabel,
  setCustomerOwner
} from "./customer-care/customer-care-support";

export function formatVnTime(date: Date): string {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())} ${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}`;
}

export interface AllocationRunResult {
  appCode: string;
  plan: PoolAllocationPlan["skippedReason"];
  assigned: number;
  failed: number;
  leftInPool: number;
}

export async function allocateCustomerPool(
  appCode: string,
  now: Date = new Date()
): Promise<AllocationRunResult> {
  const eligibleSaleIds = await listEligibleSaleIds(now);
  const plan = await planPoolAllocation({ appCode, now, eligibleSaleIds });
  const result: AllocationRunResult = {
    appCode,
    plan: plan.skippedReason,
    assigned: 0,
    failed: 0,
    leftInPool: plan.leftInPool
  };
  if (!plan.allocations.length) return result;

  const sales = await loadSaleBriefs(plan.allocations.map((a) => a.saleId));

  for (const allocation of plan.allocations) {
    const sale = sales.get(allocation.saleId);
    if (!sale) continue;
    try {
      const assigned = await runInTransaction(async (session) => {
        const res = await assignCustomerToSale({
          customerId: allocation.customerId,
          saleId: allocation.saleId,
          channel: "auto",
          assignedBy: null,
          at: now
        });
        await setCustomerOwner({
          customerId: allocation.customerId,
          sale,
          session,
          logType: "note",
          logContent: `Hệ thống tự phân khách cho ${saleLabel(sale, allocation.saleId)} (vòng ${res.round}, nhóm ${res.priorityClass})`,
          metadata: { to_sale_id: sale._id, reason: "auto_allocation" }
        });
        return res;
      });
      result.assigned += 1;
      await invalidatePermissionCache([allocation.saleId]);
      const customerLabel = await getCustomerLabel(allocation.customerId);
      await notifySale({
        sale,
        title:
          assigned.priorityClass === "A" ? "Khách nóng mới — gọi ngay" : "Bạn được giao khách mới",
        body: `${customerLabel} — nhóm ${assigned.priorityClass}. Hạn liên hệ lần đầu: ${formatVnTime(assigned.firstContactDueAt)}`,
        type: "customer_care_assigned",
        customerId: allocation.customerId
      });
    } catch (error) {
      result.failed += 1;
      if (!(error instanceof ConflictException)) {
        logger.error("Phân khách tự động thất bại", { error, allocation });
      }
    }
  }
  return result;
}
