import { OmicallClient } from "../../../utils/omicallClient";
import UserInfoModel from "../../../models/UserInfoModel";
import { SaleOmicallProfileRepository } from "../infrastructure/sale-omicall-profile.repository";

const omicallClient = new OmicallClient();
const saleOmicallProfileRepository = new SaleOmicallProfileRepository();

export interface ListInternalGroupsFilters {
  keyword?: string;
}

export interface InternalGroupMemberOption {
  fullName: string;
  maNv: string;
}

export interface InternalGroupOption {
  id: string;
  name: string;
  groupNumber: string;
  members: InternalGroupMemberOption[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ListInternalGroupsResult {
  items: InternalGroupOption[];
}

export async function listInternalGroups(
  filters: ListInternalGroupsFilters
): Promise<ListInternalGroupsResult> {
  const result = await omicallClient.listInternalGroups({
    keyword: filters.keyword,
    page: 1,
    size: 200
  });
  const groups = result.items ?? [];

  const allAgentIds = Array.from(
    new Set(groups.flatMap((group) => (group.members ?? []).map((member) => member.agent_id)))
  ).filter(Boolean);

  const profiles = allAgentIds.length
    ? await saleOmicallProfileRepository.findManyByAgentIds(allAgentIds)
    : [];
  const saleIdByAgentId = new Map(
    profiles
      .filter((profile) => profile.omicallAgentId)
      .map((profile) => [profile.omicallAgentId as string, profile.saleId])
  );

  const saleIds = Array.from(new Set(profiles.map((profile) => profile.saleId)));
  const userInfos = saleIds.length
    ? await UserInfoModel.find({ _id: { $in: saleIds }, isDeleted: false })
        .select("full_name ma_nv")
        .lean()
    : [];
  const userInfoBySaleId = new Map(
    userInfos.map((userInfo: { _id: unknown; full_name?: string; ma_nv?: string }) => [
      String(userInfo._id),
      { fullName: userInfo.full_name ?? "", maNv: userInfo.ma_nv ?? "" }
    ])
  );

  const items: InternalGroupOption[] = groups.map((group) => {
    const members: InternalGroupMemberOption[] = [];
    (group.members ?? []).forEach((member) => {
      const saleId = saleIdByAgentId.get(member.agent_id);
      const userInfo = saleId ? userInfoBySaleId.get(saleId) : undefined;
      if (!userInfo || !userInfo.maNv) return;
      members.push(userInfo);
    });

    return {
      id: group._id,
      name: group.group_name,
      groupNumber: group.group_number,
      members,
      createdAt: new Date(group.created_date),
      updatedAt: new Date(group.last_updated_date)
    };
  });

  return { items };
}
