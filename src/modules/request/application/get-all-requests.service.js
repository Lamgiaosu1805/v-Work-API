const UserInfoModel = require("../../../models/UserInfoModel");
const { RequestModel } = require("../../../models/RequestModel");
const { parsePagination } = require("../../../core/http/parse-pagination");
const {
  applyRequestTypeFilter,
  applyDateRangeFilter,
  buildUserNameSearchFilter
} = require("./request-query-filters");
const { resolveRequestViewScope } = require("./resolve-request-view-scope");

async function getAllRequests(account, query) {
  const { request_type, status, from, to, search } = query;
  const { page, limit, skip } = parsePagination(query);
  const filter = { isDeleted: false };

  const scope = await resolveRequestViewScope(account);
  const { myUserInfo } = scope;
  let scopedUserIds = scope.type === "managed" ? scope.userIds : null;

  applyRequestTypeFilter(filter, request_type);
  if (status) filter.status = status;
  applyDateRangeFilter(filter, from, to);

  if (search) {
    const matchedUsers = await UserInfoModel.find(buildUserNameSearchFilter(search)).select("_id");
    const matchedIds = matchedUsers.map((u) => u._id);

    if (scopedUserIds) {
      const matchedSet = new Set(matchedIds.map((id) => id.toString()));
      scopedUserIds = scopedUserIds.filter((id) => matchedSet.has(id.toString()));
    } else {
      scopedUserIds = matchedIds;
    }
  }

  if (scopedUserIds) filter.user_id = { $in: scopedUserIds };
  if (myUserInfo) {
    filter.user_id = { ...(filter.user_id ?? {}), $ne: myUserInfo._id };
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

module.exports = { getAllRequests };
