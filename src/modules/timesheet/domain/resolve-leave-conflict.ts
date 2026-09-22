import moment from "moment-timezone";
import { Period, PeriodValue } from "../../../shared-kernel/period";

const TZ = "Asia/Ho_Chi_Minh";
const MORNING_LEAVE_INVALIDATION_HOUR = 10;
const AFTERNOON_LEAVE_INVALIDATION_HOUR = 14;

export interface LeaveStatusSnapshot {
  id: string;
  period: PeriodValue;
  status: "leave_paid" | "leave_unpaid";
  date: Date;
}

export interface ResolveLeaveConflictInput {
  dateKey: string;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  leaveStatuses: LeaveStatusSnapshot[];
}

export interface ResolveLeaveConflictResult {
  overriddenStatusIds: string[];
  refundAmount: number;
}

export function resolveLeaveConflict({
  dateKey,
  checkInTime,
  checkOutTime,
  leaveStatuses
}: ResolveLeaveConflictInput): ResolveLeaveConflictResult {
  if (!checkInTime || !checkOutTime) return { overriddenStatusIds: [], refundAmount: 0 };
  if (!leaveStatuses.length) return { overriddenStatusIds: [], refundAmount: 0 };

  const morningCutoff = moment
    .tz(dateKey, TZ)
    .hour(MORNING_LEAVE_INVALIDATION_HOUR)
    .minute(0)
    .second(0);
  const afternoonCutoff = moment
    .tz(dateKey, TZ)
    .hour(AFTERNOON_LEAVE_INVALIDATION_HOUR)
    .minute(0)
    .second(0);
  const checkIn = moment.tz(checkInTime, TZ);
  const checkOut = moment.tz(checkOutTime, TZ);

  const coversMorning = checkIn.isBefore(morningCutoff);
  const coversAfternoon = checkOut.isAfter(afternoonCutoff);

  const overriddenStatusIds: string[] = [];
  let refundAmount = 0;

  for (const ls of leaveStatuses) {
    const period = Period.of(ls.period);
    const shouldOverride = period.isCoveredBy(coversMorning, coversAfternoon);
    if (!shouldOverride) continue;

    overriddenStatusIds.push(ls.id);

    if (ls.status === "leave_paid") {
      const isSaturday = moment.tz(ls.date, TZ).day() === 6;
      refundAmount += ls.period === "full" && !isSaturday ? 1 : 0.5;
    }
  }

  return { overriddenStatusIds, refundAmount };
}
