const UserInfoModel = require("../../../models/UserInfoModel");
const { can } = require("../../../helpers/rbac");
const { getManagedUserIds } = require("../domain/approval-chain");
const { PERMISSION } = require("../../../constants");
const { ForbiddenException, NotFoundException } = require("../../../core/exceptions/exceptions");

async function resolveRequestViewScope(account) {
  const myUserInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false });

  const hasViewAll = await can(account, PERMISSION.HRM_REQUEST_VIEW_ALL);
  if (hasViewAll) return { type: "all", myUserInfo };

  const hasReview = await can(account, PERMISSION.HRM_REQUEST_REVIEW);
  if (!hasReview) throw new ForbiddenException("Bạn không có quyền quản lý tính năng này");

  if (!myUserInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");
  const userIds = await getManagedUserIds(myUserInfo._id);
  return { type: "managed", userIds, myUserInfo };
}

module.exports = { resolveRequestViewScope };
