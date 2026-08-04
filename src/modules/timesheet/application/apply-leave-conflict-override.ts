import moment from "moment-timezone";
import { ClientSession } from "mongoose";
import { resolveLeaveConflict } from "../domain/resolve-leave-conflict";
import { WorkDayStatusRepository } from "../infrastructure/work-day-status.repository";

const TZ = "Asia/Ho_Chi_Minh";

const workDayStatusRepository = new WorkDayStatusRepository();

export interface ApplyLeaveConflictOverrideInput {
  userId: string;
  worksheetId: string;
  dateKey: string;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  lastShiftEnd: string | null;
  session?: ClientSession;
}

export interface ApplyLeaveConflictOverrideResult {
  leaveRefundAmount: number;
}

export async function applyLeaveConflictOverride({
  userId,
  worksheetId,
  dateKey,
  checkInTime,
  checkOutTime,
  lastShiftEnd,
  session
}: ApplyLeaveConflictOverrideInput): Promise<ApplyLeaveConflictOverrideResult> {
  const dateMoment = moment.tz(dateKey, TZ).startOf("day");
  const dayStart = dateMoment.toDate();
  const dayEnd = dateMoment.clone().add(1, "day").toDate();

  const leaveStatuses = await workDayStatusRepository.findLeaveStatusesForDay(
    userId,
    dayStart,
    dayEnd,
    session
  );
  const leaveConflict = resolveLeaveConflict({
    dateKey,
    checkInTime,
    checkOutTime,
    lastShiftEnd,
    leaveStatuses
  });
  await workDayStatusRepository.markStatusesPresent(
    leaveConflict.overriddenStatusIds,
    worksheetId,
    session
  );

  return { leaveRefundAmount: leaveConflict.refundAmount };
}
