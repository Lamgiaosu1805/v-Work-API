import { NotFoundException } from "../../../core/exceptions/exceptions";
import { OmicallClient } from "../../../utils/omicallClient";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();
const omicallClient = new OmicallClient();

export async function assignExtensionOutboundHotline(
  employeeId: string,
  hotlineNumber: string
): Promise<void> {
  const profile = await saleOmicallProfileRepository.findBySaleId(employeeId);
  if (!profile) {
    throw new NotFoundException("Nhân viên chưa có SIP profile để cấu hình", {
      metadata: { employeeId }
    });
  }

  await omicallClient.setExtensionHotline({
    hotline: hotlineNumber,
    userEmail: profile.omicallEmail,
    directions: ["outbound", "inbound"]
  });

  profile.update({
    sipRealm: profile.sipRealm,
    omicallExtension: profile.omicallExtension,
    sipPassword: profile.sipPassword,
    omicallAgentId: profile.omicallAgentId,
    omicallEmail: profile.omicallEmail,
    hotlineNumbers: [hotlineNumber]
  });
  await saleOmicallProfileRepository.updateById(profile.id, profile);
}
