// Thao tác tay của quản lý trên luồng chăm sóc khách (Quy định 183A, Điều 8.2b/e, 8.3).
import CustomerModel from "../models/CustomerModel";
import { runInTransaction } from "../core/db/run-in-transaction";
import { invalidatePermissionCache } from "../core/authorization/invalidate-permission-cache";
import {
  ArgumentInvalidException,
  ForbiddenException,
  NotFoundException
} from "../core/exceptions/exceptions";
import { Ability, canOnSubject } from "../modules/permission";
import {
  assignCustomerToSale,
  endActiveAssignment,
  excludeCustomerFromPool,
  getActiveAssignmentForCustomer,
  returnCustomerToPool
} from "../modules/customer-care";
import {
  getCustomerLabel,
  loadSaleBriefs,
  notifySale,
  saleLabel,
  setCustomerOwner
} from "./customer-care/customer-care-support";
import { formatVnTime } from "./allocate-customer-pool.workflow";
import { syncCustomerCareByCustomerId } from "./sync-customer-care.workflow";

function assertCanManageSale(ability: Ability, saleId: string): void {
  if (!canOnSubject(ability, "customer_care.manage", "Customer", { referred_by: saleId })) {
    throw new ForbiddenException("Bạn không có quyền điều phối khách cho Sale này");
  }
}

async function ensureCareState(customerId: string, at: Date): Promise<void> {
  const customer = await CustomerModel.exists({ _id: customerId, isDeleted: false });
  if (!customer) throw new NotFoundException("Không tìm thấy khách hàng");
  // Khách cũ chưa từng vào luồng chăm sóc → tạo trạng thái trước khi điều phối
  const synced = await syncCustomerCareByCustomerId(customerId, at);
  if (synced.action === "skipped") {
    throw new ArgumentInvalidException(
      "Khách không thuộc phạm vi chăm sóc (app chưa bật hoặc khách đại lý)"
    );
  }
  if (synced.action === "converted") {
    throw new ArgumentInvalidException("Khách đã đầu tư — không điều phối theo luồng khách mới");
  }
}

/** Phân tay (khách đang ở Pool/CSKH) hoặc chuyển Sale (khách đang có Sale — bắt buộc lý do). */
export async function manuallyAssignCustomer(input: {
  ability: Ability;
  actorAccountId: string;
  customerId: string;
  saleId: string;
  reason: string | null;
  at?: Date;
}) {
  const at = input.at ?? new Date();
  assertCanManageSale(input.ability, input.saleId);
  await ensureCareState(input.customerId, at);

  const current = (await getActiveAssignmentForCustomer(input.customerId)) as any;
  const fromSaleId = current ? String(current.sale_id) : null;
  if (fromSaleId) {
    assertCanManageSale(input.ability, fromSaleId);
    if (!input.reason?.trim())
      throw new ArgumentInvalidException("Vui lòng nhập lý do chuyển Sale");
  }
  const sales = await loadSaleBriefs([input.saleId, ...(fromSaleId ? [fromSaleId] : [])]);
  const sale = sales.get(input.saleId);
  if (!sale) throw new NotFoundException("Không tìm thấy Sale");

  const result = await runInTransaction(async (session) => {
    if (fromSaleId) {
      await endActiveAssignment({
        customerId: input.customerId,
        reason: "reassigned",
        at,
        endedBy: input.actorAccountId,
        note: input.reason?.trim() ?? null
      });
    }
    const res = await assignCustomerToSale({
      customerId: input.customerId,
      saleId: input.saleId,
      channel: "manual",
      assignedBy: input.actorAccountId,
      at
    });
    await setCustomerOwner({
      customerId: input.customerId,
      sale,
      session,
      logType: fromSaleId ? "reassigned" : "note",
      logContent: fromSaleId
        ? `Chuyển Sale từ ${saleLabel(sales.get(fromSaleId), fromSaleId)} → ${saleLabel(sale, input.saleId)}. Lý do: ${input.reason?.trim()}`
        : `Quản lý phân khách cho ${saleLabel(sale, input.saleId)}`,
      metadata: {
        from_sale_id: fromSaleId,
        to_sale_id: input.saleId,
        assigned_by: input.actorAccountId,
        reason: input.reason?.trim() || null
      }
    });
    return res;
  });

  await invalidatePermissionCache([input.saleId, ...(fromSaleId ? [fromSaleId] : [])]);
  await notifySale({
    sale,
    title: "Bạn được giao khách mới",
    body: `${await getCustomerLabel(input.customerId)} — hạn liên hệ lần đầu: ${formatVnTime(result.firstContactDueAt)}`,
    type: "customer_care_assigned",
    customerId: input.customerId
  });
  return result;
}

/** Thu hồi tay (giữ khách, khai sai, gian lận...) — bắt buộc lý do, khách về Pool/CSKH. */
export async function manuallyRevokeCustomer(input: {
  ability: Ability;
  actorAccountId: string;
  customerId: string;
  reason: string;
  at?: Date;
}) {
  const at = input.at ?? new Date();
  if (!input.reason?.trim()) throw new ArgumentInvalidException("Vui lòng nhập lý do thu hồi");
  const current = (await getActiveAssignmentForCustomer(input.customerId)) as any;
  if (!current)
    throw new NotFoundException("Khách không có Sale đang phụ trách theo luồng chăm sóc");
  const saleId = String(current.sale_id);
  assertCanManageSale(input.ability, saleId);
  const sales = await loadSaleBriefs([saleId]);

  const result = await runInTransaction(async (session) => {
    const res = await endActiveAssignment({
      customerId: input.customerId,
      reason: "revoked_manual",
      at,
      endedBy: input.actorAccountId,
      note: input.reason.trim()
    });
    await setCustomerOwner({
      customerId: input.customerId,
      sale: null,
      session,
      logType: "reassigned",
      logContent: `Quản lý thu hồi khách từ ${saleLabel(sales.get(saleId), saleId)}. Lý do: ${input.reason.trim()}`,
      metadata: {
        from_sale_id: saleId,
        removed_sale_id: saleId,
        removed_by: input.actorAccountId,
        reason: input.reason.trim()
      }
    });
    return res;
  });

  await invalidatePermissionCache([saleId]);
  await notifySale({
    sale: sales.get(saleId),
    title: "Khách đã bị thu hồi",
    body: `${await getCustomerLabel(input.customerId)} bị quản lý thu hồi. Lý do: ${input.reason.trim()}`,
    type: "customer_care_revoked",
    customerId: input.customerId
  });
  return result;
}

/** CSKH/quản lý đưa khách đang nuôi dưỡng (hoặc bị loại) về Pool khi khách có nhu cầu mới. */
export async function returnNurturingCustomerToPool(input: {
  customerId: string;
  reason: string | null;
  at?: Date;
}) {
  const customer = (await CustomerModel.findOne({ _id: input.customerId, isDeleted: false })
    .select("status identity.verified_at")
    .lean()) as any;
  if (!customer) throw new NotFoundException("Không tìm thấy khách hàng");
  await runInTransaction(() =>
    returnCustomerToPool({
      customerId: input.customerId,
      kycVerified: !!customer.identity?.verified_at || customer.status === "kyc_verified",
      at: input.at ?? new Date(),
      reason: input.reason
    })
  );
}

export async function excludeCustomer(input: { customerId: string; reason: string }) {
  if (!input.reason?.trim())
    throw new ArgumentInvalidException("Vui lòng nhập lý do loại khỏi kho chung");
  await runInTransaction(() => excludeCustomerFromPool(input.customerId, input.reason.trim()));
}
