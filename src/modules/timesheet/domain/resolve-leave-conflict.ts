import moment from "moment-timezone";
import { Period, PeriodValue } from "../../../shared-kernel/period";

const TZ = "Asia/Ho_Chi_Minh";

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
  lastShiftEnd: string | null;
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
  lastShiftEnd,
  leaveStatuses
}: ResolveLeaveConflictInput): ResolveLeaveConflictResult {
  if (!checkInTime || !checkOutTime) return { overriddenStatusIds: [], refundAmount: 0 };
  if (!leaveStatuses.length) return { overriddenStatusIds: [], refundAmount: 0 };

  const noon = moment.tz(dateKey, TZ).hour(12).minute(0).second(0);
  const checkIn = moment.tz(checkInTime, TZ);
  const checkOut = moment.tz(checkOutTime, TZ);

  const coversMorning = checkIn.isBefore(noon);

  let coversAfternoon = false;
  if (lastShiftEnd) {
    const [endH, endM] = lastShiftEnd.split(":").map(Number);
    const shiftEndMoment = moment.tz(dateKey, TZ).hour(endH).minute(endM).second(0);
    const threshold = shiftEndMoment.clone().subtract(60, "minutes");
    coversAfternoon = checkOut.isSameOrAfter(threshold);
  }

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
