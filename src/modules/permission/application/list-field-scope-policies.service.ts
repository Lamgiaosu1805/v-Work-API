import FieldScopePolicyModel from "../../../models/FieldScopePolicyModel";
import { parsePagination, PaginationQuery } from "../../../core/http/parse-pagination";

interface ListFieldScopePoliciesQuery extends PaginationQuery {
  entity?: string;
  search?: string;
}

export interface FieldScopePolicyListItem {
  id: string;
  code: string;
  entity: string;
  label: string;
  fields: string[];
  isSystemPolicy: boolean;
}

export interface ListFieldScopePoliciesResult {
  data: FieldScopePolicyListItem[];
  total: number;
  page: number;
  limit: number;
}

export async function listFieldScopePolicies(
  query: ListFieldScopePoliciesQuery = {}
): Promise<ListFieldScopePoliciesResult> {
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
    FieldScopePolicyModel.find(filter).skip(skip).limit(limit).lean(),
    FieldScopePolicyModel.countDocuments(filter)
  ]);

  const data: FieldScopePolicyListItem[] = docs.map((doc: any) => ({
    id: String(doc._id),
    code: doc.code,
    entity: doc.entity,
    label: doc.label,
    fields: doc.fields,
    isSystemPolicy: doc.isSystemPolicy
  }));

  return { data, total, page, limit };
}
