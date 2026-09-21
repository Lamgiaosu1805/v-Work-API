import mongoose from "mongoose";
import { Ability, toMongoQuery } from "../../permission";
import CustomerModel from "../../../models/CustomerModel";
import { CustomerCallStatsRepository } from "../infrastructure/customer-call-stats.repository";
import { CustomerCallStatsEntity } from "../domain/customer-call-stats.entity";
import { ForbiddenException, NotFoundException } from "../../../core/exceptions/exceptions";
import { castObjectIdFields } from "../../../core/db/cast-object-id-fields";

const customerCallStatsRepository = new CustomerCallStatsRepository();

export interface RecordCallAttemptResult {
  callCount: number;
  lastContactedAt: Date;
}

export async function recordCallAttempt(
  ability: Ability,
  customerId: string
): Promise<RecordCallAttemptResult> {
  const customerExists = await CustomerModel.exists({ _id: customerId, isDeleted: false });
  if (!customerExists) {
    throw new NotFoundException("Không tìm thấy khách hàng");
  }

  const scopeFilter = castObjectIdFields(toMongoQuery(ability, "customer_call.view", "Customer"), [
    "referred_by"
  ]);
  const inScope = await CustomerModel.exists({
    $and: [scopeFilter, { _id: customerId, isDeleted: false }]
  });
  if (!inScope) {
    throw new ForbiddenException("Bạn không có quyền gọi cho khách hàng này");
  }

  const now = new Date();
  const existing = await customerCallStatsRepository.findByCustomerId(customerId);

  if (existing) {
    existing.recordCallAttempt(now);
    await customerCallStatsRepository.updateById(existing.id, existing);
    return { callCount: existing.callCount, lastContactedAt: existing.lastContactedAt! };
  }

  const statsId = new mongoose.Types.ObjectId().toString();
  const newStats = CustomerCallStatsEntity.create({ id: statsId, customerId });
  newStats.recordCallAttempt(now);
  await customerCallStatsRepository.insert(newStats);
  return { callCount: newStats.callCount, lastContactedAt: newStats.lastContactedAt! };
}
