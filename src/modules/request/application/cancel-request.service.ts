import mongoose from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { RequestRepository } from "../infrastructure/request.repository";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import "./request-notification.handlers";
import { REQUEST_TYPE_HANDLERS } from "../domain/request-type-handlers";
import { RequestNotFoundError } from "../domain/request.errors";
import {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException
} from "../../../core/exceptions/exceptions";

const requestRepository = new RequestRepository();

export async function cancelRequest(account: any, id: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ArgumentInvalidException("ID không hợp lệ");
  }

  const entity = await runInTransaction(async (session) => {
    const myUserInfo = await UserInfoModel.findOne({
      id_account: account._id,
      isDeleted: false
    }).session(session);

    const foundEntity = await requestRepository.findOneById(id);
    if (!foundEntity) throw new RequestNotFoundError(undefined, { metadata: { requestId: id } });

    if (!myUserInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");
    if (String(foundEntity.userId) !== String(myUserInfo._id)) {
      throw new ForbiddenException("Bạn không phải chủ đơn này, không thể hủy");
    }

    foundEntity.cancel();

    const handler = REQUEST_TYPE_HANDLERS[foundEntity.requestType];
    if (handler?.onReject) {
      const props = foundEntity.getProps();
      await handler.onReject({ ...props, _id: props.id }, session, true);
    }

    await requestRepository.updateById(id, foundEntity);
    return foundEntity;
  });

  entity.publishEvents(eventBus).catch(() => {});
}
