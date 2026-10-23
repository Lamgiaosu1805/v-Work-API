import { WorkingCalendar } from "../../../shared-kernel/working-calendar";
import { computeSchedule, TicketSchedulePolicy, TicketSettings } from "../domain/ticket-schedule";
import { TicketEntity } from "../domain/ticket.entity";

// Bộ máy tính mốc thời gian cho 1 lần thao tác: cấu hình + lịch làm việc (có ngày lễ) nạp 1 lần.
export interface TicketScheduler {
  policy: TicketSchedulePolicy;
  calendar: WorkingCalendar;
  settings: TicketSettings;
}

export interface SchedulerLoader {
  load(now: Date): Promise<TicketScheduler>;
}

// Tính lại alertAt / autoCloseAt / remindAt sau MỖI thay đổi của ticket, để cảnh báo vàng chỉ cần
// so `alertAt` với giờ hiện tại khi đọc và cron chỉ query theo index.
export function refreshSchedule(ticket: TicketEntity, scheduler: TicketScheduler): void {
  const props = ticket.getProps();
  ticket.applySchedule(computeSchedule(props, scheduler.policy, scheduler.calendar));
}
