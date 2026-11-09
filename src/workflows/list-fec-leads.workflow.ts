import { Ability, toMongoQuery } from "../modules/permission";
import { getFecLeadHistory, listFecLeads, ListFecLeadsResult } from "../modules/fec-lead";

// Lead FE Credit thuộc về khách → ai xem được khách (quyền customer.view + phạm vi dữ liệu) thì xem được lead của khách đó.
// Phạm vi dựng ở đây (module fec-lead không import module permission), module chỉ áp bộ lọc nhận vào.
const customerScopeOf = (ability: Ability) => toMongoQuery(ability, "customer.view", "Customer");

export function listFecLeadsForViewer(
  ability: Ability,
  query: { appCode: string; bucket?: string; q?: string; page?: unknown; limit?: unknown }
): Promise<ListFecLeadsResult> {
  return listFecLeads({ ...query, customerScope: customerScopeOf(ability) });
}

export function getFecLeadHistoryForViewer(ability: Ability, leadGenId: string) {
  return getFecLeadHistory({ leadGenId, customerScope: customerScopeOf(ability) });
}
