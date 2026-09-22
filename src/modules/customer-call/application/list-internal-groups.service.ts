import { OmicallClient } from "../../../utils/omicallClient";
import UserInfoModel from "../../../models/UserInfoModel";
import { listOmicallAgentsByEmail } from "./list-omicall-agents.service";

const omicallClient = new OmicallClient();

export interface ListInternalGroupsFilters {
  keyword?: string;
}

export interface InternalGroupMemberOption {
  fullName: string;
  maNv: string;
  sipUser: string;
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
  const [result, agentsByEmail] = await Promise.all([
    omicallClient.listInternalGroups({
      keyword: filters.keyword,
      page: 1,
      size: 200
    }),
    listOmicallAgentsByEmail()
  ]);
  const groups = result.items ?? [];

  const agentByAgentId = new Map(
    Array.from(agentsByEmail.values()).map((agent) => [agent.id, agent])
  );

  const allEmails = Array.from(
    new Set(
      groups.flatMap((group) =>
        (group.members ?? [])
          .map((member) => agentByAgentId.get(member.agent_id)?.email?.toLowerCase())
          .filter((email): email is string => Boolean(email))
      )
    )
  );

  const userInfos = allEmails.length
    ? await UserInfoModel.find({ email: { $in: allEmails }, isDeleted: false })
        .select("full_name ma_nv email")
        .lean()
    : [];
  const userInfoByEmail = new Map(
    userInfos.map((userInfo: { full_name?: string; ma_nv?: string; email?: string }) => [
      (userInfo.email ?? "").toLowerCase(),
      { fullName: userInfo.full_name ?? "", maNv: userInfo.ma_nv ?? "" }
    ])
  );

  const items: InternalGroupOption[] = groups.map((group) => {
    const members: InternalGroupMemberOption[] = [];
    (group.members ?? []).forEach((member) => {
      const agent = agentByAgentId.get(member.agent_id);
      const email = agent?.email?.toLowerCase();
      const userInfo = email ? userInfoByEmail.get(email) : undefined;
      if (!userInfo || !userInfo.maNv || !agent?.pbx_account?.sip_user) return;
      members.push({ ...userInfo, sipUser: agent.pbx_account.sip_user });
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
