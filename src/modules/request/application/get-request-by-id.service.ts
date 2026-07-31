import mongoose from "mongoose";
import { RequestModel } from "../../../models/RequestModel";
import UserInfoModel from "../../../models/UserInfoModel";
import { can } from "../../../helpers/rbac";
import { getApprovalChain, ApprovalCandidate } from "../domain/approval-chain";
import { resolveReviewerProfileByAccountId } from "../domain/resolve-reviewer-profile";
import { RequestNotFoundError } from "../domain/request.errors";
import { PERMISSION } from "../../../constants";
import { ArgumentInvalidException, ForbiddenException } from "../../../core/exceptions/exceptions";

export async function getRequestById(account: any, id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ArgumentInvalidException("ID không hợp lệ");
  }

  const request: any = await RequestModel.findOne({ _id: id, isDeleted: false })
    .populate("user_id", "full_name ma_nv phone_number")
    .populate("reviewed_by", "full_name id_account");
  if (!request) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

  const myUserInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false });
  const isOwner = myUserInfo != null && request.user_id._id.equals(myUserInfo._id);
  const canViewAll = await can(account, PERMISSION.HRM_REQUEST_VIEW_ALL);

  let approvalChain: ApprovalCandidate[] | null = null;
  async function getChain(): Promise<ApprovalCandidate[]> {
    if (!approvalChain) approvalChain = await getApprovalChain(request.user_id._id);
    return approvalChain as ApprovalCandidate[];
  }

  let canSee = isOwner || canViewAll;
  if (!canSee) {
    const canReview = await can(account, PERMISSION.HRM_REQUEST_REVIEW);
    if (canReview) {
      const chain = await getChain();
      canSee = chain.some((c) => String(c.accountId) === account._id.toString());
    }
  }
  if (!canSee) throw new ForbiddenException("Bạn không có quyền xem đơn này");

  const [approvals, reviewed_by_profile] = await Promise.all([
    Promise.all(
      request.approvals.map(async (a: any) => ({
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
    const approvedAccountIds = new Set(request.approvals.map((a: any) => String(a.account)));
    pending_reviewer = chain.find((c) => !approvedAccountIds.has(String(c.accountId))) ?? null;
  }

  return {
    ...request.toObject(),
    approvals,
    reviewed_by_profile,
    pending_reviewer
  };
}
