import UserInfoModel from "../../../models/UserInfoModel";
import { RequestModel } from "../../../models/RequestModel";
import { NotFoundException } from "../../../core/exceptions/exceptions";
import { parsePagination } from "../../../core/http/parse-pagination";
import {
  applyRequestTypeFilter,
  applyDateRangeFilter,
  applyEventDateRangeFilter,
  RequestFilter
} from "./request-query-filters";

interface GetMyRequestsQuery {
  request_type?: string;
  status?: string;
  from?: string;
  to?: string;
  // Lọc theo khoảng NGÀY NGHỈ (YYYY-MM-DD) thay vì ngày tạo đơn.
  event_from?: string;
  event_to?: string;
  page?: unknown;
  limit?: unknown;
}

export async function getMyRequests(accountId: unknown, query: GetMyRequestsQuery) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false });
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  const { request_type, status, from, to, event_from, event_to } = query;
  const { page, limit, skip } = parsePagination(query);
  const filter: RequestFilter = { user_id: userInfo._id, isDeleted: false };

  applyRequestTypeFilter(filter, request_type);
  if (status) filter.status = status;
  applyDateRangeFilter(filter, from, to);
  applyEventDateRangeFilter(filter, event_from, event_to);

  const [requests, total] = await Promise.all([
    RequestModel.find(filter)
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
