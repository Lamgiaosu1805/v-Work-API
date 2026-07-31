const mongoose = require("mongoose");
const UserInfoModel = require("../../../models/UserInfoModel");
const { RequestRepository } = require("../infrastructure/request.repository");
const { runInTransaction } = require("../../../core/db/run-in-transaction");
const { eventBus } = require("../../../core/events/event-bus");
require("./request-notification.handlers");
const { REQUEST_TYPE_HANDLERS } = require("../domain/request-type-handlers");
const { RequestNotFoundError } = require("../domain/request.errors");
const {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException
} = require("../../../core/exceptions/exceptions");

const requestRepository = new RequestRepository();

async function cancelRequest(account, id) {
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

module.exports = { cancelRequest };
