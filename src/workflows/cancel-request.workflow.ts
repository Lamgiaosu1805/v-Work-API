import mongoose from "mongoose";
import { cancelRequestEntity } from "../modules/request/application/cancel-request.service";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";
import { eventBus } from "../core/events/event-bus";
import "../modules/request/application/request-notification.handlers";
import { runInTransaction } from "../core/db/run-in-transaction";
import { REQUEST_SIDE_EFFECTS } from "./request-side-effects";

// Chuyển nguyên orchestration từ modules/request/application/cancel-request.service.ts (task 1.8.6) —
// validate id (trước khi mở transaction, khớp thứ tự gốc) → runInTransaction (1 transaction duy nhất)
// → cancelRequestEntity (thuần Request) → dispatch onReject(isCancel=true) xuyên module nếu có.
export async function cancelRequest(account: any, id: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ArgumentInvalidException("ID không hợp lệ");
  }

  const entity = await runInTransaction(async (session) => {
    const foundEntity = await cancelRequestEntity(account, id, session);

    const sideEffects = REQUEST_SIDE_EFFECTS[foundEntity.requestType];
    if (sideEffects?.onReject) {
      const props = foundEntity.getProps();
      await sideEffects.onReject({ ...props, _id: props.id }, session, true);
    }

    return foundEntity;
  });

  entity.publishEvents(eventBus).catch(() => {});
}
