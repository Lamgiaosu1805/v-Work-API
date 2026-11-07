import mongoose, { ClientSession } from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { RequestModel } from "../../../models/RequestModel";
import { RequestRepository } from "../infrastructure/request.repository";
import { getApprovalChain } from "../domain/approval-chain";
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

export interface ReviewRequestOptions {
  action: string;
  reviewer_note?: string;
  /**
   * Người duyệt có quyền `request.approve_all` (lãnh đạo duyệt mọi đơn toàn công ty): bỏ qua phạm vi
   * dữ liệu, quyết định của họ là quyết định cuối (duyệt = chốt đơn ngay).
   */
  approveAll?: boolean;
}

export interface ReviewRequestEntityResult {
  entity: RequestEntity;
  isFinal: boolean;
}

export async function reviewRequestEntity(
  account: any,
  scopeFilter: Record<string, unknown>,
  id: string,
  { action, reviewer_note = "", approveAll = false }: ReviewRequestOptions,
  session: ClientSession
): Promise<ReviewRequestEntityResult> {
  const reviewerInfo = await UserInfoModel.findOne({
    id_account: account._id,
    isDeleted: false
  }).session(session);
  if (!reviewerInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  const allowed = await RequestModel.exists({
    $and: [{ _id: id, isDeleted: false }, approveAll ? {} : scopeFilter]
  }).session(session);
  if (!allowed) throw new ForbiddenException("Bạn không được chỉ định duyệt đơn này");

  const entity = await requestRepository.findOneById(id);
  if (!entity) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

  // Ai có quyền request.review và đơn nằm trong phạm vi (scopeFilter ở trên) là duyệt được — không
  // bắt buộc phải nằm trong chuỗi duyệt, không theo thứ tự cấp. Chuỗi duyệt (getApprovalChain) chỉ
  // dùng để gợi ý/hiển thị người duyệt, gửi thông báo và biết có bao nhiêu người duyệt được đơn này.
  if (action === "approve" && approveAll) {
    // Lãnh đạo duyệt toàn quyền: chốt đơn ngay, không chờ lượt duyệt còn lại
    entity.approve(reviewerInfo._id.toString(), reviewer_note, 1);
  } else if (action === "approve") {
    const chain = await getApprovalChain(entity.userId);
    entity.approve(
      reviewerInfo._id.toString(),
      reviewer_note,
      entity.requiredApprovals(chain.length)
    );
  } else {
    entity.reject(reviewerInfo._id.toString(), reviewer_note);
  }

  const isFinal = entity.status !== "pending";
  await requestRepository.updateById(id, entity);
  return { entity, isFinal };
}
