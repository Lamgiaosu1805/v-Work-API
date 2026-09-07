import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";
import { NotFoundException } from "../../../core/exceptions/exceptions";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export async function beginSaleOmicallProfileTransfer(
  saleId: string,
  requestId: string | null,
  targetSaleId: string
): Promise<void> {
  const profile = await saleOmicallProfileRepository.findBySaleId(saleId);
  if (!profile) {
    throw new NotFoundException("Nhân viên chưa có SIP profile để chuyển giao", {
      metadata: { saleId }
    });
  }

  profile.beginTransfer(requestId, targetSaleId);
  await saleOmicallProfileRepository.updateById(profile.id, profile);
}
