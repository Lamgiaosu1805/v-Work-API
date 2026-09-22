import { OmicallClient } from "../../../utils/omicallClient";

const omicallClient = new OmicallClient();

export interface ListHotlineRingGroupsFilters {
  keyword?: string;
}

export interface HotlineRingGroupOption {
  id: string;
  name: string;
  groupNumber: string;
  memberAgentIds: string[];
}

export interface ListHotlineRingGroupsResult {
  items: HotlineRingGroupOption[];
}

export async function listHotlineRingGroups(
  filters: ListHotlineRingGroupsFilters
): Promise<ListHotlineRingGroupsResult> {
  const result = await omicallClient.listInternalGroups({
    keyword: filters.keyword,
    page: 1,
    size: 200
  });
  const items = (result.items ?? []).map((item) => ({
    id: item._id,
    name: item.group_name,
    groupNumber: item.group_number,
    memberAgentIds: (item.members ?? []).map((member) => member.agent_id).filter(Boolean)
  }));
  return { items };
}
