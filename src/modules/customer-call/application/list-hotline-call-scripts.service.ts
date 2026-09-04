import { OmicallClient, ListCallScriptsResult } from "../../../utils/omicallClient";

const omicallClient = new OmicallClient();

export async function listHotlineCallScripts(): Promise<ListCallScriptsResult> {
  return omicallClient.listCallScripts({ page: 1, size: 100 });
}
