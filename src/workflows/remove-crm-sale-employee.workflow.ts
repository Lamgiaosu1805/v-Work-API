import { removeSaleOmicallProfile } from "../modules/customer-call";

export async function removeCrmSaleEmployee(employeeId: string): Promise<void> {
  await removeSaleOmicallProfile(employeeId);
}
