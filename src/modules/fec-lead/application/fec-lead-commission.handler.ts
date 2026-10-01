import { eventBus } from "../../../core/events/event-bus";
import { logger } from "../../../config/logger";
import { FecLeadCompletedDomainEvent } from "../domain/events/fec-lead-completed.domain-event";
import { FecLeadRepository } from "../infrastructure/fec-lead.repository";

const fecLeadRepository = new FecLeadRepository();

export async function processFecLeadCommission(
  leadGenId: string,
  customerId: string
): Promise<void> {
  logger.info("FecLead COMPLETED — cần tính hoa hồng khi có công thức được xác nhận", {
    leadGenId,
    customerId
  });
}

export async function reconcileFecLeadCommission(): Promise<number> {
  const pending = await fecLeadRepository.findCompletedPendingCommission();
  for (const lead of pending) {
    // eslint-disable-next-line no-await-in-loop
    await processFecLeadCommission(lead.leadGenId, lead.customerId);
  }
  return pending.length;
}

async function onFecLeadCompleted(event: FecLeadCompletedDomainEvent): Promise<void> {
  await processFecLeadCommission(event.leadGenId, event.customerId);
}

eventBus.on(FecLeadCompletedDomainEvent.name, onFecLeadCompleted);

export { onFecLeadCompleted };
