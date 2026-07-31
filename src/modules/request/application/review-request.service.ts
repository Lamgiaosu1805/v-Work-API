import mongoose from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { RequestRepository } from "../infrastructure/request.repository";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import "./request-notification.handlers";
import { can } from "../../../helpers/rbac";
import { getApprovalChain } from "../domain/approval-chain";
import { REQUEST_TYPE_HANDLERS } from "../domain/request-type-handlers";
import { RequestNotFoundError } from "../domain/request.errors";
import { acquireRequestReviewLock, RequestReviewLockError } from "../../../helpers/requestUtils";
import { PERMISSION } from "../../../constants";
import {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException,
  ConflictException
} from "../../../core/exceptions/exceptions";
import { RequestEntity } from "../domain/request.entity";
import { RequestType } from "../domain/types";

const requestRepository = new RequestRepository();
const VALID_ACTIONS = ["approve", "reject"];
const LEVEL1_FIRST_TYPES: RequestType[] = ["forgot_checkin", "late_early"];

async function acquireLockIfNeeded(
  id: string,
  action: string,
  preCheckEntity: RequestEntity
): Promise<(() => Promise<void>) | null> {
  if (action !== "approve" || !preCheckEntity.needsMultiApproval()) return null;
  try {
    return await acquireRequestReviewLock(id);
  } catch (error) {
    if (error instanceof RequestReviewLockError) throw new ConflictException(error.message);
    throw error;
  }
}

interface ReviewRequestOptions {
  action: string;
  reviewer_note?: string;
}

export async function reviewRequest(
  account: any,
  id: string,
  { action, reviewer_note = "" }: ReviewRequestOptions
) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ArgumentInvalidException("ID không hợp lệ");
  }
  if (!VALID_ACTIONS.includes(action)) {
    throw new ArgumentInvalidException("Hành động không hợp lệ");
  }

  const preCheckEntity = await requestRepository.findOneById(id);
  if (!preCheckEntity) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

  const release = await acquireLockIfNeeded(id, action, preCheckEntity);

  try {
    const result = await runInTransaction(async (session) => {
      const reviewerInfo = await UserInfoModel.findOne({
        id_account: account._id,
        isDeleted: false
      }).session(session);
      if (!reviewerInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

      const entity = await requestRepository.findOneById(id);
      if (!entity) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

      const canReviewAll = await can(account, PERMISSION.HRM_REQUEST_REVIEW_ALL);
      const chain = canReviewAll ? [] : await getApprovalChain(entity.userId);
      if (!canReviewAll) {
        const isInChain = chain.some((c) => String(c.accountId) === account._id.toString());
        if (!isInChain) throw new ForbiddenException("Bạn không được chỉ định duyệt đơn này");
      }

      if (
        action === "approve" &&
        !canReviewAll &&
        entity.needsMultiApproval() &&
        LEVEL1_FIRST_TYPES.includes(entity.requestType) &&
        entity.approvals.length === 0
      ) {
        const isLevel1 = chain[0]?.accountId
          ? String(chain[0].accountId) === account._id.toString()
          : false;
        if (!isLevel1) throw new ForbiddenException("Cần trưởng bộ phận duyệt trước");
      }

      if (action === "approve") {
        entity.approve(reviewerInfo._id.toString(), reviewer_note);
      } else {
        entity.reject(reviewerInfo._id.toString(), reviewer_note);
      }

      const isFinal = entity.status !== "pending";

      await requestRepository.updateById(id, entity);

      if (isFinal) {
        const handler = REQUEST_TYPE_HANDLERS[entity.requestType];
        const props = entity.getProps();
        const requestForHandler = { ...props, _id: props.id };
        if (action === "approve" && handler?.onApprove) {
          await handler.onApprove(requestForHandler, session);
        } else if (action === "reject" && handler?.onReject) {
          await handler.onReject(requestForHandler, session);
        }
      }

      return { entity, isFinal };
    });

    result.entity.publishEvents(eventBus).catch(() => {});

    return { entity: result.entity, isFinal: result.isFinal };
  } finally {
    if (release) await release();
  }
}
