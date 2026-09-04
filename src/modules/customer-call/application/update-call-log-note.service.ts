import { Ability, toMongoQuery } from "../../permission";
import CallLogModel from "../../../models/CallLogModel";
import { CallLogRepository } from "../infrastructure/call-log.repository";
import { OmicallClient } from "../../../utils/omicallClient";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import { castObjectIdFields } from "../../../core/db/cast-object-id-fields";

const callLogRepository = new CallLogRepository();
const omicallClient = new OmicallClient();

export async function updateCallLogNote(
  ability: Ability,
  callLogId: string,
  note: string
): Promise<void> {
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
    throw new ForbiddenException("Bạn không có quyền sửa ghi chú cuộc gọi này");
  }

  try {
    await omicallClient.updateCallTransaction(entity.transactionId, { note });
  } catch (error) {
    throw new ConflictException("Cập nhật ghi chú trên Omicall thất bại", {
      metadata: { transactionId: entity.transactionId, cause: (error as Error).message }
    });
  }

  entity.updateNote(note);
  await callLogRepository.updateById(entity.id, entity);
}
