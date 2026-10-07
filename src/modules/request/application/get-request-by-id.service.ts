import mongoose from "mongoose";
import { RequestModel } from "../../../models/RequestModel";
import UserInfoModel from "../../../models/UserInfoModel";
import { getApprovalChain, ApprovalCandidate } from "../domain/approval-chain";
import { resolveReviewerProfileByAccountId } from "../domain/resolve-reviewer-profile";
import { RequestNotFoundError } from "../domain/request.errors";
import { approvalModeOf } from "../domain/request.entity";
import { ArgumentInvalidException, ForbiddenException } from "../../../core/exceptions/exceptions";

export async function getRequestById(
  account: any,
  scopeFilter: Record<string, unknown>,
  id: string
) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ArgumentInvalidException("ID không hợp lệ");
  }

  const request: any = await RequestModel.findOne({ _id: id, isDeleted: false })
    .populate("user_id", "full_name ma_nv phone_number")
    .populate("reviewed_by", "full_name id_account");
  if (!request) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

  const myUserInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false });
  const isOwner = myUserInfo != null && request.user_id._id.equals(myUserInfo._id);

  let approvalChain: ApprovalCandidate[] | null = null;
  async function getChain(): Promise<ApprovalCandidate[]> {
    if (!approvalChain) approvalChain = await getApprovalChain(request.user_id._id);
    return approvalChain as ApprovalCandidate[];
  }

  let canSee = isOwner;
  if (!canSee) {
    const match = await RequestModel.exists({ $and: [{ _id: id, isDeleted: false }, scopeFilter] });
    canSee = !!match;
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
  // Hiển thị đủ cả 2 cấp phê duyệt (trực tiếp + gián tiếp) cùng lúc, kèm trạng thái đã duyệt hay
  // chưa của từng cấp — trước đây chỉ trả `pending_reviewer` (1 người kế tiếp), FE không có cách
  // hiển thị song song cả 2 cấp trong luồng phê duyệt.
  // `role`: "approver" (người duyệt) | "informed" (chỉ nhận thông tin — cấp 2 của đơn nghỉ dưới 2
  // ngày), theo approval_mode (xem ApprovalMode ở request.entity.ts).
  const approval_mode = approvalModeOf(request);
  let approval_chain: Array<
    ApprovalCandidate & { approved: boolean; role: "approver" | "informed" }
  > = [];
  if (request.status === "pending") {
    const chain = await getChain();
    // approvals[].account thực tế lưu user_info._id của người duyệt (xem reviewRequestEntity) — so
    // cả 2 id để cờ `approved` đúng.
    const approvedIds = new Set(request.approvals.map((a: any) => String(a.account)));
    const isApproved = (c: ApprovalCandidate) =>
      approvedIds.has(String(c.accountId)) || approvedIds.has(String(c.userInfoId));
    approval_chain = chain.map((c, index) => ({
      ...c,
      approved: isApproved(c),
      role: approval_mode === "direct_only" && index > 0 ? "informed" : "approver"
    }));
    pending_reviewer = approval_chain.find((c) => c.role === "approver" && !c.approved) ?? null;
  }

  return {
    ...request.toObject(),
    approvals,
    reviewed_by_profile,
    pending_reviewer,
    approval_mode,
    approval_chain
  };
}
