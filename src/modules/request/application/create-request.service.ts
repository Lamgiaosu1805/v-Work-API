import UserInfoModel from "../../../models/UserInfoModel";
import { RequestEntity } from "../domain/request.entity";
import { RequestRepository } from "../infrastructure/request.repository";
import { REQUEST_TYPE_HANDLERS } from "../domain/request-type-handlers";
import { VALID_TYPES } from "./request-query-filters";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { eventBus } from "../../../core/events/event-bus";
import "./request-notification.handlers";
import {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException,
  ConflictException
} from "../../../core/exceptions/exceptions";
import { ExceptionBase } from "../../../core/exceptions/exception.base";
import { RequestType } from "../domain/types";

const requestRepository = new RequestRepository();

interface HandlerError {
  status?: number;
  message: string;
}

function toHandlerException({ status, message }: HandlerError): ExceptionBase {
  if (status === 403) return new ForbiddenException(message);
  if (status === 404) return new NotFoundException(message);
  if (status === 409) return new ConflictException(message);
  return new ArgumentInvalidException(message);
}

export async function createRequest(account: any, body: any) {
  const { request_type, reason } = body;
  if (!VALID_TYPES.includes(request_type)) {
    throw new ArgumentInvalidException("Loại đơn không hợp lệ");
  }

  const handler = REQUEST_TYPE_HANDLERS[request_type as RequestType];

  const userInfo = await UserInfoModel.findOne({ id_account: account._id, isDeleted: false });
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  const { payload, error } = await handler.validate(body, userInfo);
  if (error) throw toHandlerException(error);

  const entity = await runInTransaction(async (session) => {
    // validateAsync trả về: null (không có gì thêm) | {status, message} (lỗi) |
    // {...field} (field bổ sung cần merge vào entity trước khi tạo, vd occurrence
    // của late_early/forgot_checkin — tính trước khi tạo nên không cần loại trừ
    // chính đơn đang tạo ra khỏi phép đếm).
    const asyncResult = await handler.validateAsync(payload, userInfo, session);
    if (asyncResult?.status) throw toHandlerException(asyncResult);

    const newEntity = RequestEntity.create({
      userId: userInfo._id.toString(),
      requestType: request_type,
      reason,
      ...payload,
      ...asyncResult
    });

    await requestRepository.insert(newEntity);

    if (handler.onCreate) {
      const props = newEntity.getProps();
      const sideError = await handler.onCreate({ ...props, _id: props.id }, userInfo, session);
      if (sideError) throw toHandlerException(sideError);
    }

    return newEntity;
  });

  entity.publishEvents(eventBus).catch(() => {});

  return entity;
}
