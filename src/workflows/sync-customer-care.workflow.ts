// Đưa khách vào / cập nhật phạm vi chăm sóc sau mỗi sự kiện vòng đời từ app (đăng ký, eKYC, nhập mã
// giới thiệu, đầu tư, duyệt yêu cầu nhận khách). Gọi SAU KHI transaction của code cũ đã commit.
import CustomerModel from "../models/CustomerModel";
import AppModel from "../models/AppModel";
import InvestmentModel from "../models/InvestmentModel";
import { logger } from "../config/logger";
import { runInTransaction } from "../core/db/run-in-transaction";
import {
  AssignmentChannel,
  getActiveAssignmentForCustomer,
  syncCustomerCare,
  SyncCustomerCareResult
} from "../modules/customer-care";

export interface SyncCustomerCareOptions {
  /** Kênh cho lượt giao nếu Customer vừa đổi Sale từ màn cũ (manual / claim / referral) */
  ownerChannel?: AssignmentChannel;
  actorAccountId?: string | null;
}

export async function syncCustomerCareByCustomerId(
  customerId: string,
  at: Date = new Date(),
  options: SyncCustomerCareOptions = {}
): Promise<SyncCustomerCareResult> {
  const customer = (await CustomerModel.findOne({ _id: customerId, isDeleted: false })
    .select("app_id referred_by agent_id status identity.verified_at")
    .lean()) as any;
  if (!customer) return { action: "skipped" };
  // Khách của đại lý không thuộc luồng phân cho Sale
  if (customer.agent_id && !customer.referred_by) return { action: "skipped" };

  const app = (await AppModel.findById(customer.app_id).select("code").lean()) as any;
  if (!app?.code) return { action: "skipped" };

  const hasInvestment = !!(await InvestmentModel.exists({
    customer_id: customerId,
    isDeleted: false,
    status: { $ne: "cancelled" }
  }));

  return runInTransaction(() =>
    syncCustomerCare({
      customerId: String(customerId),
      appId: String(customer.app_id),
      appCode: app.code,
      kycVerified: !!customer.identity?.verified_at || customer.status === "kyc_verified",
      hasInvestment,
      currentSaleId: customer.referred_by ? String(customer.referred_by) : null,
      at,
      ownerChannel: options.ownerChannel,
      actorAccountId: options.actorAccountId ?? null
    })
  );
}

/** Dùng trong controller cũ: không làm hỏng response nếu đồng bộ lỗi, chỉ ghi log. */
export function syncCustomerCareInBackground(
  customerId: unknown,
  options: SyncCustomerCareOptions = {}
): void {
  if (!customerId) return;
  syncCustomerCareByCustomerId(String(customerId), new Date(), options).catch((error) =>
    logger.error("Không đồng bộ được trạng thái chăm sóc khách", {
      error,
      customerId: String(customerId)
    })
  );
}

/**
 * Khách đang do HỆ THỐNG/QUẢN LÝ phân (kênh auto/manual) — Sale giới thiệu thật vẫn được gửi & duyệt
 * yêu cầu nhận khách (Quy định 183A: giữ cơ chế yêu cầu nhận khách cho khách do Sale giới thiệu).
 */
export async function isCustomerSystemAssigned(customerId: unknown): Promise<boolean> {
  if (!customerId) return false;
  const active = (await getActiveAssignmentForCustomer(String(customerId))) as any;
  return !!active && (active.channel === "auto" || active.channel === "manual");
}
