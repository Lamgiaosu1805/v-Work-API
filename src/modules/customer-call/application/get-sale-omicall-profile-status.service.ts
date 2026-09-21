import { NotFoundException } from "../../../core/exceptions/exceptions";
import { OmicallClient } from "../../../utils/omicallClient";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();
const omicallClient = new OmicallClient();

export interface SaleOmicallProfileStatus {
  sipRealm: string;
  sipUser: string;
  sipPassword: string;
  hotlineNumbers: string[];
  isSynced: boolean;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

export async function getSaleOmicallProfileStatus(
  employeeId: string
): Promise<SaleOmicallProfileStatus> {
  const profile = await saleOmicallProfileRepository.findBySaleId(employeeId);
  if (!profile) {
    throw new NotFoundException("Nhân viên chưa có tài khoản Omicall", {
      metadata: { employeeId }
    });
  }

  let { hotlineNumbers } = profile;
  let isSynced = false;
  try {
    const detail = await omicallClient.getExtensionDetail("user_email", profile.omicallEmail);
    const extensionMatches =
      Boolean(detail?.pbx_account) &&
      detail!.pbx_account.sip_user === profile.omicallExtension &&
      detail!.pbx_account.sip_password === profile.sipPassword;

    if (profile.hotlineNumbers.length === 0 && (detail?.hotlines?.length ?? 0) > 0) {
      hotlineNumbers = detail!.hotlines;
      profile.update({
        sipRealm: profile.sipRealm,
        omicallExtension: profile.omicallExtension,
        sipPassword: profile.sipPassword,
        omicallAgentId: profile.omicallAgentId,
        omicallEmail: profile.omicallEmail,
        hotlineNumbers
      });
      await saleOmicallProfileRepository.updateById(profile.id, profile);
    }

    const hotlineMatches =
      hotlineNumbers.length === 0 || sameStringSet(hotlineNumbers, detail?.hotlines ?? []);

    isSynced = extensionMatches && hotlineMatches;
  } catch {
    isSynced = false;
  }

  return {
    sipRealm: profile.sipRealm,
    sipUser: profile.omicallExtension,
    sipPassword: profile.sipPassword,
    hotlineNumbers,
    isSynced
  };
}
