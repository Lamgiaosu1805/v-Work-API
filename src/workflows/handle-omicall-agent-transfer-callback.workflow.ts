import { completeSaleOmicallProfileTransferFromWebhook } from "../modules/customer-call";
import { setCrmSaleRoleId } from "./set-crm-sale-role.workflow";

export async function handleOmicallAgentTransferCallback(body: unknown): Promise<void> {
  const result = await completeSaleOmicallProfileTransferFromWebhook(body);

  if (result.outcome === "success") {
    await setCrmSaleRoleId(result.sourceEmployeeId, null);
  }
}
