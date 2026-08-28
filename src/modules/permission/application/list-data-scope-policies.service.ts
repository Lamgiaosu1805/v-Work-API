import DataScopePolicyModel from "../../../models/DataScopePolicyModel";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";

interface ListDataScopePoliciesQuery extends PaginationQuery {
  entity?: string;
  search?: string;
}

export interface DataScopePolicyListItem {
  id: string;
  code: string;
  entity: string;
  label: string;
  isSystemPolicy: boolean;
}

export interface ListDataScopePoliciesResult {
  data: DataScopePolicyListItem[];
  total: number;
  page: number;
  limit: number;
}

export async function listDataScopePolicies(
  query: ListDataScopePoliciesQuery = {}
): Promise<ListDataScopePoliciesResult> {
  const { entity, search } = query;
  const { page, limit, skip } = parsePagination(query);

  const filter: Record<string, unknown> = { isDeleted: false };
  if (entity) filter.entity = entity;
  if (search) {
    filter.$or = [
      { code: { $regex: search, $options: "i" } },
      { label: { $regex: search, $options: "i" } }
    ];
  }

  const [docs, total] = await Promise.all([
    DataScopePolicyModel.find(filter).skip(skip).limit(limit).lean(),
    DataScopePolicyModel.countDocuments(filter)
  ]);

  const data: DataScopePolicyListItem[] = docs.map((doc: any) => ({
    id: String(doc._id),
    code: doc.code,
    entity: doc.entity,
    label: doc.label,
    isSystemPolicy: doc.isSystemPolicy
  }));

  return { data, total, page, limit };
}
