import UserInfoModel from "../../../models/UserInfoModel";
import { RequestModel } from "../../../models/RequestModel";
import { parsePagination } from "../../../core/http/parse-pagination";
import {
  applyRequestTypeFilter,
  applyDateRangeFilter,
  buildUserNameSearchFilter,
  RequestFilter
} from "./request-query-filters";
import { resolveRequestViewScope } from "./resolve-request-view-scope";

interface GetAllRequestsQuery {
  request_type?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: unknown;
  limit?: unknown;
}

export async function getAllRequests(account: any, query: GetAllRequestsQuery) {
  const { request_type, status, from, to, search } = query;
  const { page, limit, skip } = parsePagination(query);
  const filter: RequestFilter = { isDeleted: false };

  const scope = await resolveRequestViewScope(account);
  const { myUserInfo } = scope;
  let scopedUserIds: unknown[] | null = scope.type === "managed" ? (scope.userIds ?? null) : null;

  applyRequestTypeFilter(filter, request_type);
  if (status) filter.status = status;
  applyDateRangeFilter(filter, from, to);

  if (search) {
    const matchedUsers = await UserInfoModel.find(buildUserNameSearchFilter(search)).select("_id");
    const matchedIds = matchedUsers.map((u: any) => u._id);

    if (scopedUserIds) {
      const matchedSet = new Set(matchedIds.map((id: any) => id.toString()));
      scopedUserIds = scopedUserIds.filter((id: any) => matchedSet.has(id.toString()));
    } else {
      scopedUserIds = matchedIds;
    }
  }

  if (scopedUserIds) filter.user_id = { $in: scopedUserIds };
  if (myUserInfo) {
    filter.user_id = {
      ...((filter.user_id as Record<string, unknown>) ?? {}),
      $ne: myUserInfo._id
    };
  }

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
