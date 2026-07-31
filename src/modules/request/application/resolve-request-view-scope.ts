import UserInfoModel from "../../../models/UserInfoModel";
import { can } from "../../../helpers/rbac";
import { getManagedUserIds } from "../domain/approval-chain";
import { PERMISSION } from "../../../constants";
import { ForbiddenException, NotFoundException } from "../../../core/exceptions/exceptions";

export interface RequestViewScope {
  type: "all" | "managed";
  myUserInfo: any;
  userIds?: unknown[];
}

export async function resolveRequestViewScope(account: any): Promise<RequestViewScope> {
  const myUserInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false });

  const hasViewAll = await can(account, PERMISSION.HRM_REQUEST_VIEW_ALL);
  if (hasViewAll) return { type: "all", myUserInfo };

  const hasReview = await can(account, PERMISSION.HRM_REQUEST_REVIEW);
  if (!hasReview) throw new ForbiddenException("Bạn không có quyền quản lý tính năng này");

  if (!myUserInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");
  const userIds = await getManagedUserIds(myUserInfo._id);
  return { type: "managed", userIds, myUserInfo };
}
