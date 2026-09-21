import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export interface SyncHotlineExtensionAssignmentsResult {
  assigned: string[];
  unassigned: string[];
}

export async function syncHotlineExtensionAssignments(
  hotlineNumber: string,
  extensionsToAssign: string[],
  extensionsToUnassign: string[]
): Promise<SyncHotlineExtensionAssignmentsResult> {
  const assigned: string[] = [];
  for (const sipUser of extensionsToAssign) {
    // eslint-disable-next-line no-await-in-loop
    const profile = await saleOmicallProfileRepository.findByExtension(sipUser);
    if (!profile) continue;

    profile.update({
      sipRealm: profile.sipRealm,
      omicallExtension: profile.omicallExtension,
      sipPassword: profile.sipPassword,
      omicallAgentId: profile.omicallAgentId,
      omicallEmail: profile.omicallEmail,
      hotlineNumbers: [hotlineNumber]
    });
    // eslint-disable-next-line no-await-in-loop
    await saleOmicallProfileRepository.updateById(profile.id, profile);
    assigned.push(sipUser);
  }

  const unassigned: string[] = [];
  for (const sipUser of extensionsToUnassign) {
    // eslint-disable-next-line no-await-in-loop
    const profile = await saleOmicallProfileRepository.findByExtension(sipUser);
    if (!profile || !profile.hotlineNumbers.includes(hotlineNumber)) continue;

    profile.update({
      sipRealm: profile.sipRealm,
      omicallExtension: profile.omicallExtension,
      sipPassword: profile.sipPassword,
      omicallAgentId: profile.omicallAgentId,
      omicallEmail: profile.omicallEmail,
      hotlineNumbers: profile.hotlineNumbers.filter((hotline) => hotline !== hotlineNumber)
    });
    // eslint-disable-next-line no-await-in-loop
    await saleOmicallProfileRepository.updateById(profile.id, profile);
    unassigned.push(sipUser);
  }

  return { assigned, unassigned };
}
