import { Ability, toMongoQuery } from "../../permission";
import CallLogModel from "../../../models/CallLogModel";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";

export interface ListCallHistoryFilters extends PaginationQuery {
  customerId?: string;
  saleId?: string;
  direction?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ListCallHistoryResult {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
}

export async function listCallHistory(
  ability: Ability,
  filters: ListCallHistoryFilters
): Promise<ListCallHistoryResult> {
  const { page, limit, skip } = parsePagination(filters);
  const scopeFilter = toMongoQuery(ability, "call_log.view", "CallLog");

  const query: Record<string, unknown> = { ...scopeFilter, isDeleted: false };
  if (filters.customerId) query.customer_id = filters.customerId;
  if (filters.saleId) query.sale_id = filters.saleId;
  if (filters.direction) query.direction = filters.direction;
  if (filters.fromDate || filters.toDate) {
    query.time_start_call = {
      ...(filters.fromDate ? { $gte: new Date(filters.fromDate) } : {}),
      ...(filters.toDate ? { $lte: new Date(filters.toDate) } : {})
    };
  }

  const [data, total] = await Promise.all([
    CallLogModel.find(query).sort({ time_start_call: -1 }).skip(skip).limit(limit).lean(),
    CallLogModel.countDocuments(query)
  ]);

  return { data, total, page, limit };
}
