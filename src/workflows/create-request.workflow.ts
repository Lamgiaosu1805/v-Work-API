import {
  createRequestEntity,
  toHandlerException
} from "../modules/request/application/create-request.service";
import { eventBus } from "../core/events/event-bus";
import "../modules/request/application/request-notification.handlers";
import { runInTransaction } from "../core/db/run-in-transaction";
import { REQUEST_SIDE_EFFECTS } from "./request-side-effects";

// Chuyển nguyên orchestration từ modules/request/application/create-request.service.ts (task 1.8.6) —
// mở runInTransaction (chỉ 1 nơi duy nhất cho toàn bộ luồng tạo đơn, khớp CLAUDE.md "ghi >1 collection
// phải dùng transaction") rồi gọi createRequestEntity (thuần Request) + dispatch side-effect xuyên
// module (REQUEST_SIDE_EFFECTS, chỉ 2 loại đơn có onCreate: leave/forgot_checkin) trong CÙNG 1
// transaction — giữ nguyên atomicity gốc (lỗi ở side-effect thì rollback luôn cả việc tạo đơn, đã có
// test xác nhận hành vi này ở create-request.test.js, giờ port sang __tests__/workflows/).
export async function createRequest(account: any, body: any) {
  const entity = await runInTransaction(async (session) => {
    const { entity: newEntity, userInfo } = await createRequestEntity(account, body, session);

    const sideEffects = REQUEST_SIDE_EFFECTS[newEntity.requestType];
    if (sideEffects?.onCreate) {
      const props = newEntity.getProps();
      const sideError = await sideEffects.onCreate({ ...props, _id: props.id }, userInfo, session);
      if (sideError) throw toHandlerException(sideError);
    }

    return newEntity;
  });

  entity.publishEvents(eventBus).catch(() => {});

  return entity;
}
