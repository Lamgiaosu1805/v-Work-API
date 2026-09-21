import { ClientSession } from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { RequestRepository } from "../infrastructure/request.repository";
import { RequestEntity } from "../domain/request.entity";
import { RequestNotFoundError } from "../domain/request.errors";
import { NotFoundException, ForbiddenException } from "../../../core/exceptions/exceptions";

const requestRepository = new RequestRepository();

export async function cancelRequestEntity(
  account: any,
  id: string,
  session: ClientSession
): Promise<RequestEntity> {
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

  await requestRepository.updateById(id, foundEntity);
  return foundEntity;
}
