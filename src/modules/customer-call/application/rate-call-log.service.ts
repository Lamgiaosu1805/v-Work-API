import { Ability, toMongoQuery } from "../../permission";
import CallLogModel from "../../../models/CallLogModel";
import { CallLogRepository } from "../infrastructure/call-log.repository";
import {
  ArgumentInvalidException,
  ForbiddenException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import { castObjectIdFields } from "../../../core/db/cast-object-id-fields";

const callLogRepository = new CallLogRepository();

export async function rateCallLog(
  ability: Ability,
  callLogId: string,
  rating: number,
  note?: string
): Promise<void> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ArgumentInvalidException("Đánh giá phải là số nguyên từ 1 đến 5");
  }

  const entity = await callLogRepository.findOneById(callLogId);
  if (!entity) {
    throw new NotFoundException("Không tìm thấy cuộc gọi");
  }

  const scopeFilter = castObjectIdFields(toMongoQuery(ability, "call_log.update_note", "CallLog"), [
    "sale_id"
  ]);
  const inScope = await CallLogModel.exists({
    $and: [scopeFilter, { _id: callLogId, isDeleted: false }]
  });
  if (!inScope) {
    throw new ForbiddenException("Bạn không có quyền đánh giá cuộc gọi này");
  }

  entity.rate(rating);
  if (note !== undefined) {
    entity.updateNote(note);
  }
  await callLogRepository.updateById(entity.id, entity);
}
