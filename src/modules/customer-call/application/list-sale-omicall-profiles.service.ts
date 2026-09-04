import SaleOmicallProfileModel from "../../../models/SaleOmicallProfileModel";

export interface SaleOmicallProfileSummary {
  saleId: string;
  omicallExtension: string;
  omicallEmail: string | null;
}

export async function listSaleOmicallProfilesBySaleIds(
  saleIds: string[]
): Promise<SaleOmicallProfileSummary[]> {
  if (saleIds.length === 0) return [];

  const profiles = await SaleOmicallProfileModel.find({
    sale_id: { $in: saleIds },
    isDeleted: false
  }).lean();

  return profiles.map((profile) => ({
    saleId: String(profile.sale_id),
    omicallExtension: profile.omicall_extension,
    omicallEmail: profile.omicall_email ?? null
  }));
}
