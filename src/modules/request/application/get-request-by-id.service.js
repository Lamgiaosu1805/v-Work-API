const mongoose = require("mongoose");
const { RequestModel } = require("../../../models/RequestModel");
const UserInfoModel = require("../../../models/UserInfoModel");
const { can } = require("../../../helpers/rbac");
const { getApprovalChain } = require("../domain/approval-chain");
const { resolveReviewerProfileByAccountId } = require("../domain/resolve-reviewer-profile");
const { PERMISSION } = require("../../../constants");
const {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException
} = require("../../../core/exceptions/exceptions");

async function getRequestById(account, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ArgumentInvalidException("ID không hợp lệ");
  }

  const request = await RequestModel.findOne({ _id: id, isDeleted: false })
    .populate("user_id", "full_name ma_nv phone_number")
    .populate("reviewed_by", "full_name id_account");
  if (!request) throw new NotFoundException("Đơn không tồn tại");

  const myUserInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false });
  const isOwner = Boolean(myUserInfo) && request.user_id._id.equals(myUserInfo._id);
  const canViewAll = await can(account, PERMISSION.HRM_REQUEST_VIEW_ALL);

  let approvalChain = null;
  async function getChain() {
    if (!approvalChain) approvalChain = await getApprovalChain(request.user_id._id);
    return approvalChain;
  }

  let canSee = isOwner || canViewAll;
  if (!canSee) {
    const canReview = await can(account, PERMISSION.HRM_REQUEST_REVIEW);
    if (canReview) {
      const chain = await getChain();
      canSee = chain.some((c) => c.accountId.toString() === account._id.toString());
    }
  }
  if (!canSee) throw new ForbiddenException("Bạn không có quyền xem đơn này");

  const [approvals, reviewed_by_profile] = await Promise.all([
    Promise.all(
      request.approvals.map(async (a) => ({
        account: a.account,
        reviewed_at: a.reviewed_at,
        reviewer: await resolveReviewerProfileByAccountId(a.account)
      }))
    ),
    request.reviewed_by
      ? resolveReviewerProfileByAccountId(request.reviewed_by.id_account)
      : Promise.resolve(null)
  ]);

  let pending_reviewer = null;
  if (request.status === "pending") {
    const chain = await getChain();
    const approvedAccountIds = new Set(request.approvals.map((a) => String(a.account)));
    pending_reviewer = chain.find((c) => !approvedAccountIds.has(String(c.accountId))) ?? null;
  }

  return {
    ...request.toObject(),
    approvals,
    reviewed_by_profile,
    pending_reviewer
  };
}

module.exports = { getRequestById };
