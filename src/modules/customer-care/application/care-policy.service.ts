import CustomerCarePolicyModel from "../../../models/CustomerCarePolicyModel";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { buildCarePolicy, CarePolicy, validateCarePolicy } from "../domain/care-policy";
import { policyFromDoc, policyToDoc } from "../infrastructure/care-context";

export interface CarePolicyView extends CarePolicy {
  configured: boolean;
  version: number;
  updatedAt: Date | null;
}

export async function getCarePolicyView(appCode: string): Promise<CarePolicyView> {
  const doc = (await CustomerCarePolicyModel.findOne({
    app_code: appCode,
    isDeleted: false
  }).lean()) as any;
  return {
    ...policyFromDoc(appCode, doc),
    configured: !!doc,
    version: doc?.version ?? 0,
    updatedAt: doc?.updatedAt ?? null
  };
}

export type CarePolicyPatch = Partial<Omit<CarePolicy, "appCode" | "sla" | "capacityByRank">> & {
  sla?: Partial<Record<"A" | "B", Partial<CarePolicy["sla"]["A"]>>>;
  capacityByRank?: Partial<CarePolicy["capacityByRank"]>;
};

/** Cập nhật (hoặc tạo lần đầu = bật phạm vi cho app) chính sách — validate trước khi lưu, tăng version. */
export async function updateCarePolicy(
  appCode: string,
  patch: CarePolicyPatch,
  updatedBy: string
): Promise<CarePolicyView> {
  const current = await getCarePolicyView(appCode);
  const merged = buildCarePolicy(appCode, {
    ...current,
    ...patch,
    sla: {
      A: { ...current.sla.A, ...(patch.sla?.A ?? {}) },
      B: { ...current.sla.B, ...(patch.sla?.B ?? {}) }
    },
    capacityByRank: { ...current.capacityByRank, ...(patch.capacityByRank ?? {}) }
  });
  const errors = validateCarePolicy(merged);
  if (errors.length) {
    throw new ArgumentInvalidException(errors.join("; "));
  }

  await CustomerCarePolicyModel.findOneAndUpdate(
    { app_code: appCode, isDeleted: false },
    { $set: { ...policyToDoc(merged), updated_by: updatedBy }, $inc: { version: 1 } },
    { upsert: true, new: true }
  );
  return getCarePolicyView(appCode);
}
