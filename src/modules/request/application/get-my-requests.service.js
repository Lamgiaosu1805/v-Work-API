const UserInfoModel = require("../../../models/UserInfoModel");
const { RequestModel } = require("../../../models/RequestModel");
const { NotFoundException } = require("../../../core/exceptions/exceptions");
const { parsePagination } = require("../../../core/http/parse-pagination");
const { applyRequestTypeFilter, applyDateRangeFilter } = require("./request-query-filters");

async function getMyRequests(accountId, query) {
  const userInfo = await UserInfoModel.findOne({ id_account: accountId, isDeleted: false });
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  const { request_type, status, from, to } = query;
  const { page, limit, skip } = parsePagination(query);
  const filter = { user_id: userInfo._id, isDeleted: false };

  applyRequestTypeFilter(filter, request_type);
  if (status) filter.status = status;
  applyDateRangeFilter(filter, from, to);

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

module.exports = { getMyRequests };
