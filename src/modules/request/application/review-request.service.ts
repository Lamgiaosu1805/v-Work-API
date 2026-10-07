import mongoose, { ClientSession } from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { RequestModel } from "../../../models/RequestModel";
import { RequestRepository } from "../infrastructure/request.repository";
import { getApprovalChain, ApprovalCandidate } from "../domain/approval-chain";
import { RequestNotFoundError } from "../domain/request.errors";
import { acquireRequestReviewLock, RequestReviewLockError } from "../../../helpers/requestUtils";
import {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException,
  ConflictException
} from "../../../core/exceptions/exceptions";
import { RequestEntity } from "../domain/request.entity";

const requestRepository = new RequestRepository();
export const VALID_ACTIONS = ["approve", "reject"];

export async function acquireReviewLockIfNeeded(
  id: string,
  action: string
): Promise<(() => Promise<void>) | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ArgumentInvalidException("ID không hợp lệ");
  }
  if (!VALID_ACTIONS.includes(action)) {
    throw new ArgumentInvalidException("Hành động không hợp lệ");
  }

  const preCheckEntity = await requestRepository.findOneById(id);
  if (!preCheckEntity) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

  if (action !== "approve" || !preCheckEntity.needsMultiApproval()) return null;
  try {
    return await acquireRequestReviewLock(id);
  } catch (error) {
    if (error instanceof RequestReviewLockError) throw new ConflictException(error.message);
    throw error;
  }
}

function assertCanActOnCurrentStep(
  entity: RequestEntity,
  chain: ApprovalCandidate[],
  reviewer: { accountId: string; userInfoId: string; action: string }
): void {
  const levelIndex = chain.findIndex(
    (candidate) => String(candidate.accountId) === reviewer.accountId
  );
  if (levelIndex === -1) throw new ForbiddenException("Bạn không được chỉ định duyệt đơn này");

  const mode = entity.approvalMode();
  if (mode === "any") return;

  if (mode === "direct_only") {
    if (levelIndex !== 0) {
      throw new ForbiddenException(
        "Đơn nghỉ dưới 2 ngày do quản lý trực tiếp duyệt, quản lý gián tiếp chỉ nhận thông tin"
      );
    }
    return;
  }

  const currentStep = Math.min(entity.approvals.length, chain.length - 1);
  if (levelIndex > currentStep) {
    throw new ForbiddenException("Đơn đang chờ quản lý trực tiếp duyệt trước");
  }
  if (levelIndex < currentStep) {
    const alreadyApproved = entity.approvals.some(
      (approval) => String(approval.account) === reviewer.userInfoId
    );
    if (alreadyApproved && reviewer.action === "approve") return;
    throw new ForbiddenException("Đơn đã chuyển sang quản lý gián tiếp duyệt");
  }
}

export interface ReviewRequestOptions {
  action: string;
  reviewer_note?: string;
}

export interface ReviewRequestEntityResult {
  entity: RequestEntity;
  isFinal: boolean;
}

export async function reviewRequestEntity(
  account: any,
  scopeFilter: Record<string, unknown>,
  id: string,
  { action, reviewer_note = "" }: ReviewRequestOptions,
  session: ClientSession
): Promise<ReviewRequestEntityResult> {
  const reviewerInfo = await UserInfoModel.findOne({
    id_account: account._id,
    isDeleted: false
  }).session(session);
  if (!reviewerInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  const allowed = await RequestModel.exists({
    $and: [{ _id: id, isDeleted: false }, scopeFilter]
  }).session(session);
  if (!allowed) throw new ForbiddenException("Bạn không được chỉ định duyệt đơn này");

  const entity = await requestRepository.findOneById(id);
  if (!entity) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

  // Data Scope chỉ giới hạn tập dữ liệu có thể truy cập. Người thực sự được duyệt phải nằm trong
  // chuỗi quản lý mới (direct_manager/department.manager); quyền cũ hoặc role admin không bypass.
  const chain = await getApprovalChain(entity.userId);
  assertCanActOnCurrentStep(entity, chain, {
    accountId: account._id.toString(),
    userInfoId: reviewerInfo._id.toString(),
    action
  });

  if (action === "approve") {
    const configuredLevels = chain.length === 1 && chain[0].source === "admin" ? 0 : chain.length;
    entity.approve(
      reviewerInfo._id.toString(),
      reviewer_note,
      entity.requiredApprovals(configuredLevels)
    );
  } else {
    entity.reject(reviewerInfo._id.toString(), reviewer_note);
  }

  const isFinal = entity.status !== "pending";
  await requestRepository.updateById(id, entity);
  return { entity, isFinal };
}
