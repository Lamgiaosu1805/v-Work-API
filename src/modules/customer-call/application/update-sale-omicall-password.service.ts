import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";
import { NotFoundException } from "../../../core/exceptions/exceptions";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export async function updateSaleOmicallPassword(
  saleId: string,
  newPassword: string
): Promise<void> {
  const profile = await saleOmicallProfileRepository.findBySaleId(saleId);
  if (!profile) {
    throw new NotFoundException("Nhân viên chưa có SIP profile để cập nhật mật khẩu", {
      metadata: { saleId }
    });
  }

  profile.update({
    sipRealm: profile.sipRealm,
    omicallExtension: profile.omicallExtension,
    sipPassword: newPassword,
    omicallAgentId: profile.omicallAgentId,
    omicallEmail: profile.omicallEmail
  });

  await saleOmicallProfileRepository.updateById(profile.id, profile);
}
