import HolidayModel from "../../../models/HolidayModel";
import TicketSettingModel from "../../../models/TicketSettingModel";
import {
  toVnDateKey,
  WorkingCalendar,
  WorkingCalendarConfig
} from "../../../shared-kernel/working-calendar";
import {
  DEFAULT_TICKET_CALENDAR_CONFIG,
  DEFAULT_TICKET_SCHEDULE_POLICY,
  TicketSettings
} from "../domain/ticket-schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
export const TICKET_SETTING_KEY = "default";

export function defaultTicketSettings(): TicketSettings {
  return {
    policy: DEFAULT_TICKET_SCHEDULE_POLICY,
    calendar: DEFAULT_TICKET_CALENDAR_CONFIG,
    defaultHandlerIds: []
  };
}

// Mixed trong Mongo lưu key là chuỗi ("6") → đổi về key số theo getUTCDay của giờ VN.
function toDayWindows(raw: unknown): WorkingCalendarConfig["dayWindows"] {
  if (!raw || typeof raw !== "object") return undefined;
  const windows: NonNullable<WorkingCalendarConfig["dayWindows"]> = {};
  Object.entries(raw as Record<string, { startMinute: number; endMinute: number }>).forEach(
    ([day, window]) => {
      if (window) windows[Number(day)] = window;
    }
  );
  return windows;
}

export function settingsFromDoc(doc: any): TicketSettings {
  if (!doc) return defaultTicketSettings();
  const base = DEFAULT_TICKET_SCHEDULE_POLICY;
  return {
    policy: {
      workdayMinutes: doc.workday_minutes ?? base.workdayMinutes,
      unclaimedMinutes: { ...base.unclaimedMinutes, ...(doc.unclaimed_minutes ?? {}) },
      silentMinutes: { ...base.silentMinutes, ...(doc.silent_minutes ?? {}) },
      holdUnknownDays: doc.hold_unknown_days ?? base.holdUnknownDays,
      autoCloseResolvedDays: doc.auto_close_resolved_days ?? base.autoCloseResolvedDays,
      autoCloseWaitingInfoDays: doc.auto_close_waiting_info_days ?? base.autoCloseWaitingInfoDays,
      reopenDays: doc.reopen_days ?? base.reopenDays
    },
    calendar: {
      workStartMinute: doc.work_start_minute ?? DEFAULT_TICKET_CALENDAR_CONFIG.workStartMinute,
      workEndMinute: doc.work_end_minute ?? DEFAULT_TICKET_CALENDAR_CONFIG.workEndMinute,
      workDays: doc.work_days ?? DEFAULT_TICKET_CALENDAR_CONFIG.workDays,
      dayWindows: toDayWindows(doc.day_windows) ?? DEFAULT_TICKET_CALENDAR_CONFIG.dayWindows
    },
    defaultHandlerIds: (doc.default_handler_ids ?? []).map(String)
  };
}

export async function loadTicketSettings(): Promise<TicketSettings> {
  const doc = await TicketSettingModel.findOne({
    key: TICKET_SETTING_KEY,
    isDeleted: false
  }).lean();
  return settingsFromDoc(doc);
}

// Ngày lễ áp toàn công ty quanh thời điểm `from` (các mốc ticket tính tối đa vài chục ngày làm việc).
export async function loadTicketCalendar(
  settings: TicketSettings,
  from: Date
): Promise<WorkingCalendar> {
  const holidays = (await HolidayModel.find({
    isDeleted: false,
    scope_type: "all",
    date: {
      $gte: new Date(from.getTime() - 30 * DAY_MS),
      $lte: new Date(from.getTime() + 90 * DAY_MS)
    }
  })
    .select("date duration_days")
    .lean()) as { date: Date; duration_days?: number }[];

  const keys: string[] = [];
  holidays.forEach((holiday) => {
    const days = Math.max(1, Math.ceil(holiday.duration_days ?? 1));
    for (let i = 0; i < days; i += 1) {
      keys.push(toVnDateKey(new Date(new Date(holiday.date).getTime() + i * DAY_MS)));
    }
  });

  return new WorkingCalendar({ ...settings.calendar, holidays: keys });
}
