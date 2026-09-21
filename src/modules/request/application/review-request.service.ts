import mongoose, { ClientSession } from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { RequestModel } from "../../../models/RequestModel";
import { RequestRepository } from "../infrastructure/request.repository";
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

  if (action === "approve") {
    entity.approve(reviewerInfo._id.toString(), reviewer_note);
  } else {
    entity.reject(reviewerInfo._id.toString(), reviewer_note);
  }

  const isFinal = entity.status !== "pending";

  await requestRepository.updateById(id, entity);

  return { entity, isFinal };
}
