import CustomerModel from "../models/CustomerModel";
import CustomerInteractionModel from "../models/CustomerInteractionModel";
import UserInfoModel from "../models/UserInfoModel";
import { runInTransaction } from "../core/db/run-in-transaction";
import { NotFoundException } from "../core/exceptions/exceptions";
import { invalidatePermissionCache } from "../core/authorization/invalidate-permission-cache";

export async function reassignSaleCustomers(
  oldSaleId: string,
  newSaleId: string,
  reason: string
): Promise<number> {
  const [oldSale, newSale] = await Promise.all([
    UserInfoModel.findById(oldSaleId).select("full_name ma_nv").lean(),
    UserInfoModel.findById(newSaleId).select("full_name ma_nv phone_number").lean()
  ]);
  if (!newSale) {
    throw new NotFoundException("Không tìm thấy nhân viên nhận chuyển giao khách hàng", {
      metadata: { newSaleId }
    });
  }

  const oldSaleName = oldSale
    ? `${(oldSale as { full_name?: string }).full_name} (${(oldSale as { ma_nv?: string }).ma_nv})`
    : "chưa có";
  const newSaleName = `${(newSale as { full_name?: string }).full_name} (${(newSale as { ma_nv?: string }).ma_nv})`;
  const newRefCode = `${(newSale as { phone_number?: string }).phone_number}-${(newSale as { ma_nv?: string }).ma_nv}`;

  const customers = await CustomerModel.find({ referred_by: oldSaleId, isDeleted: false })
    .select("_id app_id referred_at")
    .lean();

  if (customers.length === 0) return 0;

  await runInTransaction(async (session) => {
    for (const customer of customers) {
      const updateData: Record<string, unknown> = {
        referred_by: newSaleId,
        ref_code: newRefCode
      };
      if (!(customer as { referred_at?: Date | null }).referred_at) {
        updateData.referred_at = new Date();
      }

      await CustomerModel.updateOne({ _id: customer._id }, { $set: updateData }, { session });

      await CustomerInteractionModel.create(
        [
          {
            app_id: (customer as { app_id?: unknown }).app_id,
            customer_id: customer._id,
            sale_id: newSaleId,
            agent_id: null,
            type: "reassigned",
            content: `Chuyển sale từ ${oldSaleName} → ${newSaleName} (tự động do ${reason})`,
            result: null
          }
        ],
        { session }
      );
    }
  });

  await invalidatePermissionCache([oldSaleId, newSaleId]);

  return customers.length;
}
