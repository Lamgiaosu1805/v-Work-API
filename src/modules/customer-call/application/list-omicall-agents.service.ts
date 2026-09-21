import { OmicallClient, OmicallAgentItem } from "../../../utils/omicallClient";

const omicallClient = new OmicallClient();
const PAGE_SIZE = 50;

export async function listOmicallAgentsByEmail(): Promise<Map<string, OmicallAgentItem>> {
  const byEmail = new Map<string, OmicallAgentItem>();
  let page = 1;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const result = await omicallClient.searchAgents({ page, size: PAGE_SIZE });
    result.items.forEach((agent) => {
      if (agent.email) byEmail.set(agent.email, agent);
    });

    if (!result.has_next || result.items.length < PAGE_SIZE) break;
    page += 1;
  }

  return byEmail;
}
