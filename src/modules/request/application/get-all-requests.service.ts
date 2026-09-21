import UserInfoModel from "../../../models/UserInfoModel";
import { RequestModel } from "../../../models/RequestModel";
import { parsePagination } from "../../../core/http/parse-pagination";
import {
  applyRequestTypeFilter,
  applyDateRangeFilter,
  buildUserNameSearchFilter,
  RequestFilter
} from "./request-query-filters";

interface GetAllRequestsQuery {
  request_type?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: unknown;
  limit?: unknown;
  intent?: string;
}

export async function getAllRequests(
  account: any,
  scopeFilter: Record<string, unknown>,
  query: GetAllRequestsQuery
) {
  const { request_type, status, from, to, search } = query;
  const { page, limit, skip } = parsePagination(query);
  const filter: RequestFilter = { isDeleted: false };

  const myUserInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false });

  applyRequestTypeFilter(filter, request_type);
  if (status) filter.status = status;
  applyDateRangeFilter(filter, from, to);

  const andConditions: Record<string, unknown>[] = [scopeFilter];
  if (myUserInfo) andConditions.push({ user_id: { $ne: myUserInfo._id } });

  if (search) {
    const matchedUsers = await UserInfoModel.find(buildUserNameSearchFilter(search)).select("_id");
    andConditions.push({ user_id: { $in: matchedUsers.map((u: any) => u._id) } });
  }

  filter.$and = andConditions;

  const [requests, total] = await Promise.all([
    RequestModel.find(filter)
      .populate("user_id", "full_name ma_nv phone_number")
      .populate("reviewed_by", "full_name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    RequestModel.countDocuments(filter)
  ]);

  return {
    data: requests,
    pagination: {
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit)
    }
  };
}
