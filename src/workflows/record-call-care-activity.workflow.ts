// Cuộc gọi tổng đài kết thúc → ghi nhận liên hệ / hoạt động hợp lệ cho lượt giao khách (Điều 3.3, 7).
// Listener được đăng ký khi file này được require (từ jobs/customerCareJob.js — composition root).
import { eventBus } from "../core/events/event-bus";
import { logger } from "../config/logger";
import { CallLogEndedDomainEvent } from "../modules/customer-call";
import { recordCallActivity, RecordActivityResult } from "../modules/customer-care";

export async function recordCallCareActivity(
  event: Pick<CallLogEndedDomainEvent, "saleId" | "customerId" | "timeStartCall" | "answerSec">
): Promise<RecordActivityResult> {
  if (!event.saleId || !event.customerId) {
    return { counted: false, valid: false, assignmentId: null };
  }
  return recordCallActivity({
    customerId: event.customerId,
    saleId: event.saleId,
    at: new Date(event.timeStartCall),
    answerSec: event.answerSec ?? 0
  });
}

let registered = false;

export function registerCallCareActivityListener(): void {
  if (registered) return;
  registered = true;
  eventBus.on(CallLogEndedDomainEvent.name, async (event: CallLogEndedDomainEvent) => {
    try {
      await recordCallCareActivity(event);
    } catch (error) {
      logger.error("Không ghi nhận được cuộc gọi vào SLA chăm sóc khách", {
        error,
        callLogId: event.aggregateId
      });
    }
  });
}
