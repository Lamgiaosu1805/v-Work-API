const mongoose = require("mongoose");
const UserInfoModel = require("../../../models/UserInfoModel");
const { RequestRepository } = require("../infrastructure/request.repository");
const { runInTransaction } = require("../../../core/db/run-in-transaction");
const { eventBus } = require("../../../core/events/event-bus");
require("./request-notification.handlers");
const { can } = require("../../../helpers/rbac");
const { getApprovalChain } = require("../domain/approval-chain");
const { REQUEST_TYPE_HANDLERS } = require("../domain/request-type-handlers");
const { RequestNotFoundError } = require("../domain/request.errors");
const {
  acquireRequestReviewLock,
  RequestReviewLockError
} = require("../../../helpers/requestUtils");
const { PERMISSION } = require("../../../constants");
const {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException,
  ConflictException
} = require("../../../core/exceptions/exceptions");

const requestRepository = new RequestRepository();
const VALID_ACTIONS = ["approve", "reject"];
const LEVEL1_FIRST_TYPES = ["forgot_checkin", "late_early"];

async function acquireLockIfNeeded(id, action, preCheckEntity) {
  if (action !== "approve" || !preCheckEntity.needsMultiApproval()) return null;
  try {
    return await acquireRequestReviewLock(id);
  } catch (error) {
    if (error instanceof RequestReviewLockError) throw new ConflictException(error.message);
    throw error;
  }
}

async function reviewRequest(account, id, { action, reviewer_note = "" }) {
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
        const isInChain = chain.some((c) => c.accountId.toString() === account._id.toString());
        if (!isInChain) throw new ForbiddenException("Bạn không được chỉ định duyệt đơn này");
      }

      if (
        action === "approve" &&
        !canReviewAll &&
        entity.needsMultiApproval() &&
        LEVEL1_FIRST_TYPES.includes(entity.requestType) &&
        entity.approvals.length === 0
      ) {
        const isLevel1 = chain[0]?.accountId?.toString() === account._id.toString();
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

module.exports = { reviewRequest };
