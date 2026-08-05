import {
  acquireReviewLockIfNeeded,
  reviewRequestEntity,
  ReviewRequestOptions
} from "../modules/request/application/review-request.service";
import { eventBus } from "../core/events/event-bus";
import "../modules/request/application/request-notification.handlers";
import { runInTransaction } from "../core/db/run-in-transaction";
import { REQUEST_SIDE_EFFECTS } from "./request-side-effects";

// Chuyển nguyên orchestration từ modules/request/application/review-request.service.ts (task 1.8.6) —
// acquire Redis lock (nếu cần, TRƯỚC khi mở transaction — giữ đúng thứ tự gốc) → runInTransaction (1
// transaction duy nhất) → reviewRequestEntity (thuần Request) → dispatch side-effect xuyên module
// (REQUEST_SIDE_EFFECTS) CHỈ khi isFinal, đúng hành vi gốc (đơn đa duyệt lần 1 chưa final thì không
// chạy side-effect).
export async function reviewRequest(account: any, id: string, options: ReviewRequestOptions) {
  const release = await acquireReviewLockIfNeeded(id, options.action);

  try {
    const result = await runInTransaction(async (session) => {
      const { entity, isFinal } = await reviewRequestEntity(account, id, options, session);

      if (isFinal) {
        const sideEffects = REQUEST_SIDE_EFFECTS[entity.requestType];
        const props = entity.getProps();
        const requestForHandler = { ...props, _id: props.id };
        if (options.action === "approve" && sideEffects?.onApprove) {
          await sideEffects.onApprove(requestForHandler, session);
        } else if (options.action === "reject" && sideEffects?.onReject) {
          await sideEffects.onReject(requestForHandler, session);
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
