import {
  WorkingCalendar,
  WorkingCalendarConfig,
  startOfVnDay
} from "../../../shared-kernel/working-calendar";
import { AlertReason, TicketProps, TicketUrgency } from "./types";

// Tính các mốc thời gian của ticket (thuần domain, không đọc DB). Thiết kế: docs/TICKET-MODULE-PLAN.md
// mục 4.5 (tự đóng / mở lại) và mục 8 (cảnh báo vàng thay cho SLA).
//
// Cảnh báo vàng KHÔNG đo "nhanh hay chậm" mà đo "ticket có đang bị bỏ quên không":
//   - unclaimed:    ticket "open" quá lâu chưa ai nhận
//   - silent:       ticket "in_progress" không có hoạt động nào quá lâu (trừ khi nhóm xử lý đã tự hẹn ngày)
//   - overdue:      quá ngày hẹn do nhóm xử lý tự đặt / quá ngày dự kiến tiếp tục khi tạm hoãn
//   - hold_unknown: tạm hoãn chưa xác định ngày, không có cập nhật quá lâu
// Ticket đang chờ người tạo (waiting_info / resolved) hoặc đã kết thúc không bị cảnh báo.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TicketSchedulePolicy {
  // Số phút làm việc của 1 "ngày làm việc" khi quy đổi "N ngày" → phút (mặc định 540 = ca 08:00–17:00).
  workdayMinutes: number;
  // Ngưỡng cảnh báo tính bằng PHÚT LÀM VIỆC, theo mức khẩn.
  unclaimedMinutes: Record<TicketUrgency, number>;
  silentMinutes: Record<TicketUrgency, number>;
  holdUnknownDays: number;
  autoCloseResolvedDays: number;
  autoCloseWaitingInfoDays: number;
  reopenDays: number;
}

export const DEFAULT_TICKET_SCHEDULE_POLICY: TicketSchedulePolicy = {
  workdayMinutes: 540,
  unclaimedMinutes: { urgent: 60, normal: 1 * 540, low: 3 * 540 },
  silentMinutes: { urgent: 4 * 60, normal: 3 * 540, low: 7 * 540 },
  holdUnknownDays: 5,
  autoCloseResolvedDays: 3,
  autoCloseWaitingInfoDays: 3,
  reopenDays: 3
};

// Cấu hình ticket đã nạp từ DB (xem infrastructure/ticket-settings.ts).
export interface TicketSettings {
  policy: TicketSchedulePolicy;
  calendar: Omit<WorkingCalendarConfig, "holidays">;
  // Người nhận thông báo ticket Khẩn khi mẫu/loại yêu cầu không chỉ định ai
  defaultHandlerIds: string[];
}

// Lịch làm việc mặc định của ticket: T2–T6 08:00–17:00, T7 chỉ buổi sáng 08:00–12:00.
export const DEFAULT_TICKET_CALENDAR_CONFIG = {
  workStartMinute: 8 * 60,
  workEndMinute: 17 * 60,
  workDays: [1, 2, 3, 4, 5, 6],
  dayWindows: { 6: { startMinute: 8 * 60, endMinute: 12 * 60 } }
};

export type ScheduleInput = Pick<
  TicketProps,
  | "status"
  | "urgency"
  | "lastActivityAt"
  | "statusChangedAt"
  | "dueHintAt"
  | "hold"
  | "followUp"
  | "reminderSentAt"
> & { assignment: Pick<TicketProps["assignment"], "ownerId"> };

export interface TicketSchedule {
  alertAt: Date | null;
  alertReason: AlertReason | null;
  autoCloseAt: Date | null;
  remindAt: Date | null;
}

const NONE: TicketSchedule = {
  alertAt: null,
  alertReason: null,
  autoCloseAt: null,
  remindAt: null
};

function endOfVnDay(date: Date): Date {
  return new Date(startOfVnDay(date).getTime() + DAY_MS);
}

function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export function computeSchedule(
  ticket: ScheduleInput,
  policy: TicketSchedulePolicy,
  calendar: WorkingCalendar
): TicketSchedule {
  const days = (count: number) => count * policy.workdayMinutes;

  switch (ticket.status) {
    case "open":
      return {
        ...NONE,
        alertAt: calendar.addWorkingMinutes(
          ticket.statusChangedAt,
          policy.unclaimedMinutes[ticket.urgency]
        ),
        alertReason: "unclaimed"
      };

    case "in_progress": {
      // Nhóm xử lý đã tự hẹn ngày thì chỉ vàng khi qua hết ngày đó, không vàng vì "im lặng".
      if (ticket.dueHintAt) {
        return { ...NONE, alertAt: endOfVnDay(ticket.dueHintAt), alertReason: "overdue" };
      }
      return {
        ...NONE,
        alertAt: calendar.addWorkingMinutes(
          ticket.lastActivityAt,
          policy.silentMinutes[ticket.urgency]
        ),
        alertReason: "silent"
      };
    }

    case "on_hold": {
      if (ticket.hold?.resumeAt) {
        return { ...NONE, alertAt: ticket.hold.resumeAt, alertReason: "overdue" };
      }
      return {
        ...NONE,
        alertAt: calendar.addWorkingMinutes(ticket.lastActivityAt, days(policy.holdUnknownDays)),
        alertReason: "hold_unknown"
      };
    }

    case "waiting_info": {
      const autoCloseAt = calendar.addWorkingMinutes(
        ticket.statusChangedAt,
        days(policy.autoCloseWaitingInfoDays)
      );
      // Nhắc người tạo 1 lần trước khi tự đóng 1 ngày làm việc.
      const remindAt = calendar.addWorkingMinutes(
        ticket.statusChangedAt,
        days(Math.max(policy.autoCloseWaitingInfoDays - 1, 0))
      );
      return {
        ...NONE,
        autoCloseAt,
        remindAt: ticket.reminderSentAt ? null : remindAt
      };
    }

    case "resolved": {
      const closeFrom = ticket.followUp?.checkAt
        ? later(ticket.statusChangedAt, ticket.followUp.checkAt)
        : ticket.statusChangedAt;
      return {
        ...NONE,
        // "Cần theo dõi thêm": không tự đóng trước ngày kiểm tra; tới ngày đó nhắc nhóm xử lý.
        autoCloseAt: calendar.addWorkingMinutes(closeFrom, days(policy.autoCloseResolvedDays)),
        remindAt:
          ticket.followUp?.checkAt && !ticket.reminderSentAt ? ticket.followUp.checkAt : null
      };
    }

    default:
      return NONE;
  }
}

// Hạn mở lại sau khi ticket đóng mà người tạo chưa xác nhận: N ngày làm việc kể từ lúc đóng.
export function computeReopenUntil(
  closedAt: Date,
  policy: TicketSchedulePolicy,
  calendar: WorkingCalendar
): Date {
  return calendar.addWorkingMinutes(closedAt, policy.reopenDays * policy.workdayMinutes);
}

// Ticket đang bị bôi vàng khi còn xử lý dở và đã quá mốc cảnh báo.
export function isYellow(
  ticket: Pick<TicketProps, "status" | "alertAt">,
  now: Date = new Date()
): boolean {
  return (
    ["open", "in_progress", "on_hold"].includes(ticket.status) &&
    ticket.alertAt !== null &&
    ticket.alertAt.getTime() <= now.getTime()
  );
}
