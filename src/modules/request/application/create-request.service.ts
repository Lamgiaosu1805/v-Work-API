import { ClientSession } from "mongoose";
import UserInfoModel from "../../../models/UserInfoModel";
import { RequestEntity } from "../domain/request.entity";
import { RequestRepository } from "../infrastructure/request.repository";
import { REQUEST_TYPE_HANDLERS } from "../domain/request-type-handlers";
import { VALID_TYPES } from "./request-query-filters";
import {
  ArgumentInvalidException,
  NotFoundException,
  ForbiddenException,
  ConflictException
} from "../../../core/exceptions/exceptions";
import { ExceptionBase } from "../../../core/exceptions/exception.base";
import { RequestType } from "../domain/types";

const requestRepository = new RequestRepository();

export interface HandlerError {
  status?: number;
  message: string;
}

export function toHandlerException({ status, message }: HandlerError): ExceptionBase {
  if (status === 403) return new ForbiddenException(message);
  if (status === 404) return new NotFoundException(message);
  if (status === 409) return new ConflictException(message);
  return new ArgumentInvalidException(message);
}

export interface CreateRequestEntityResult {
  entity: RequestEntity;
  userInfo: any;
}

// Chỉ còn phần thuần Request: validate/validateAsync (business rule của handler, không đụng module
// khác) + tạo entity + persist. KHÔNG còn tự mở transaction (nhận `session` từ ngoài) và KHÔNG còn tự
// dispatch handler.onCreate (side-effect xuyên Timesheet/Leave — đã chuyển sang
// workflows/request-side-effects/, xem workflows/create-request.workflow.ts, task 1.8.6) — đúng rule #1
// mục 13 ("modules/x chỉ import core/, shared-kernel/, và chính nó").
export async function createRequestEntity(
  account: any,
  body: any,
  session: ClientSession
): Promise<CreateRequestEntityResult> {
  const { request_type, reason } = body;
  if (!VALID_TYPES.includes(request_type)) {
    throw new ArgumentInvalidException("Loại đơn không hợp lệ");
  }

  const handler = REQUEST_TYPE_HANDLERS[request_type as RequestType];

  const userInfo = await UserInfoModel.findOne({
    id_account: account._id,
    isDeleted: false
  }).session(session);
  if (!userInfo) throw new NotFoundException("Không tìm thấy thông tin nhân viên");

  // SRS "Đơn từ" (update 3/8/2026) — "Lý do" là field bắt buộc chung cho popup tạo đơn của MỌI loại
  // đơn (không riêng 1 loại) — max 100 ký tự, tự loại bỏ khoảng trắng đầu/cuối. Trước đây `reason`
  // mặc định "" nếu không nhập (RequestEntity.create), không thực sự bắt buộc — sửa lại đúng SRS.
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (!trimmedReason) {
    throw new ArgumentInvalidException("Vui lòng nhập lý do");
  }
  if (trimmedReason.length > 100) {
    throw new ArgumentInvalidException("Lý do không được vượt quá 100 ký tự");
  }

  const { payload, error } = await handler.validate(body, userInfo);
  if (error) throw toHandlerException(error);

  // validateAsync trả về: null (không có gì thêm) | {status, message} (lỗi) |
  // {...field} (field bổ sung cần merge vào entity trước khi tạo, vd occurrence
  // của late_early/forgot_checkin — tính trước khi tạo nên không cần loại trừ
  // chính đơn đang tạo ra khỏi phép đếm).
  const asyncResult = await handler.validateAsync(payload, userInfo, session);
  if (asyncResult?.status) throw toHandlerException(asyncResult);

  const newEntity = RequestEntity.create({
    userId: userInfo._id.toString(),
    requestType: request_type,
    reason: trimmedReason,
    ...payload,
    ...asyncResult
  });

  await requestRepository.insert(newEntity);

  return { entity: newEntity, userInfo };
}
