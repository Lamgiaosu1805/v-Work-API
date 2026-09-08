import mongoose from "mongoose";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../../../models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../../../models/CustomerModel");

interface CustomerCandidate {
  _id: mongoose.Types.ObjectId;
  app_id: mongoose.Types.ObjectId;
  referred_by: mongoose.Types.ObjectId | null;
}

export async function resolveCustomerForCall(
  phoneNumber: string,
  hotline: string | null | undefined,
  saleId: string | null
): Promise<CustomerCandidate | null> {
  const candidates: CustomerCandidate[] = await CustomerModel.find({
    phone_number: phoneNumber,
    isDeleted: false
  })
    .select("_id app_id referred_by")
    .lean();

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (hotline) {
    const app = await AppModel.findOne({ hotline_numbers: hotline, is_active: true })
      .select("_id")
      .lean();
    if (app) {
      const matchedByApp = candidates.find((c) => String(c.app_id) === String(app._id));
      if (matchedByApp) return matchedByApp;
    }
  }

  if (saleId) {
    const matchedBySale = candidates.find((c) => c.referred_by && String(c.referred_by) === saleId);
    if (matchedBySale) return matchedBySale;
  }

  return candidates[0];
}
