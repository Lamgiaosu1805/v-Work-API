import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export async function removeSaleOmicallProfile(saleId: string): Promise<void> {
  const profile = await saleOmicallProfileRepository.findBySaleId(saleId);
  if (!profile) return;
  await saleOmicallProfileRepository.delete(profile);
}
