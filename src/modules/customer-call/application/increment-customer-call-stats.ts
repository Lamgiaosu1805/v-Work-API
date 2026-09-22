import mongoose from "mongoose";
import { CustomerCallStatsRepository } from "../infrastructure/customer-call-stats.repository";
import { CustomerCallStatsEntity } from "../domain/customer-call-stats.entity";

const customerCallStatsRepository = new CustomerCallStatsRepository();

export async function incrementCustomerCallStats(customerId: string, at: Date): Promise<void> {
  const existing = await customerCallStatsRepository.findByCustomerId(customerId);
  if (existing) {
    existing.recordCallAttempt(at);
    await customerCallStatsRepository.updateById(existing.id, existing);
    return;
  }

  const statsId = new mongoose.Types.ObjectId().toString();
  const newStats = CustomerCallStatsEntity.create({ id: statsId, customerId });
  newStats.recordCallAttempt(at);
  await customerCallStatsRepository.insert(newStats);
}
