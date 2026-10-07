// Thu hồi khách của Sale nghỉ việc / account bị xoá / bị khoá nhận khách (Quy định 183A, Điều 8.2d).
// Chạy hằng ngày. Sale bị KHOÁ chỉ trả các khách do hệ thống/quản lý giao — khách Sale tự giới thiệu
// (kênh referral/claim) vẫn giữ; Sale NGHỈ VIỆC thì trả toàn bộ.
import CustomerAssignmentModel from "../models/CustomerAssignmentModel";
import UserInfoModel from "../models/UserInfoModel";
import AccountModel from "../models/AccountModel";
import { logger } from "../config/logger";
import { runInTransaction } from "../core/db/run-in-transaction";
import { invalidatePermissionCache } from "../core/authorization/invalidate-permission-cache";
import { endActiveAssignment, isSaleLocked } from "../modules/customer-care";
import { loadSaleBriefs, saleLabel, setCustomerOwner } from "./customer-care/customer-care-support";

export async function releaseUnavailableSaleCustomers(now: Date = new Date()): Promise<number> {
  const saleIds = (
    await CustomerAssignmentModel.distinct("sale_id", {
      status: "active",
      isDeleted: false
    })
  ).map(String);
  if (!saleIds.length) return 0;

  const userInfos = (await UserInfoModel.find({ _id: { $in: saleIds } })
    .select("resignation_date id_account isDeleted")
    .lean()) as any[];
  const accounts = (await AccountModel.find({
    _id: { $in: userInfos.map((u) => u.id_account).filter(Boolean) }
  })
    .select("isDeleted")
    .lean()) as any[];
  const deletedAccounts = new Set(accounts.filter((a) => a.isDeleted).map((a) => String(a._id)));

  const toRelease = new Map<string, "sale_gone" | "sale_locked">();
  for (const u of userInfos) {
    const gone =
      u.isDeleted ||
      (u.resignation_date && new Date(u.resignation_date).getTime() <= now.getTime()) ||
      (u.id_account && deletedAccounts.has(String(u.id_account)));
    if (gone) toRelease.set(String(u._id), "sale_gone");
    else if (await isSaleLocked(String(u._id))) toRelease.set(String(u._id), "sale_locked");
  }
  if (!toRelease.size) return 0;

  const sales = await loadSaleBriefs(Array.from(toRelease.keys()));
  let released = 0;
  for (const [saleId, cause] of toRelease) {
    const filter: Record<string, unknown> = { sale_id: saleId, status: "active", isDeleted: false };
    if (cause === "sale_locked") filter.channel = { $nin: ["referral", "claim"] };
    const assignments = (await CustomerAssignmentModel.find(filter)
      .select("customer_id")
      .lean()) as any[];
    const reasonText = cause === "sale_gone" ? "Sale nghỉ việc" : "Sale bị khoá nhận khách";

    for (const assignment of assignments) {
      const customerId = String(assignment.customer_id);
      try {
        await runInTransaction(async (session) => {
          await endActiveAssignment({
            customerId,
            reason: "sale_offboarded",
            at: now,
            endedBy: null,
            note: reasonText
          });
          await setCustomerOwner({
            customerId,
            sale: null,
            session,
            logType: "reassigned",
            logContent: `Thu hồi khách từ ${saleLabel(sales.get(saleId), saleId)} do ${reasonText}`,
            metadata: { from_sale_id: saleId, removed_sale_id: saleId, reason: "sale_offboarded" }
          });
        });
        released += 1;
      } catch (error) {
        logger.error("Không thu hồi được khách của Sale không còn nhận khách", {
          error,
          saleId,
          customerId
        });
      }
    }
    await invalidatePermissionCache([saleId]);
  }
  return released;
}
