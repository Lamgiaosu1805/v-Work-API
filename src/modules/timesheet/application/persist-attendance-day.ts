import moment from "moment-timezone";
import { ClientSession } from "mongoose";
import { ResolveAttendanceDayComputed } from "../domain/resolve-attendance-day";
import { WorkDayStatus } from "../domain/work-day-status-rules";
import { WorkSheetRepository } from "../infrastructure/work-sheet.repository";
import { WorkDayStatusRepository } from "../infrastructure/work-day-status.repository";
import { applyLeaveConflictOverride } from "./apply-leave-conflict-override";

const TZ = "Asia/Ho_Chi_Minh";

const workSheetRepository = new WorkSheetRepository();
const workDayStatusRepository = new WorkDayStatusRepository();

export interface PersistAttendanceDayInput {
  userId: string;
  worksheetId: string;
  dateKey: string;
  computed: ResolveAttendanceDayComputed;
  session?: ClientSession;
}

export interface PersistAttendanceDayResult {
  leaveRefundAmount: number;
}

function resolvePeriodStatus(isAbsent: boolean, isMissed: boolean): WorkDayStatus {
  if (isAbsent) return "absent";
  if (isMissed) return "missed_clock";
  return "present";
}

export async function persistAttendanceDay({
  userId,
  worksheetId,
  dateKey,
  computed,
  session
}: PersistAttendanceDayInput): Promise<PersistAttendanceDayResult> {
  await workSheetRepository.applyComputedResult(
    worksheetId,
    {
      check_in: computed.newCheckIn,
      check_out: computed.newCheckOut,
      minutes_late: computed.minutesLate,
      minute_early: computed.minutesEarly,
      work_unit: computed.work_unit,
      penalty_amount: computed.penalty_amount
    },
    session
  );

  const dateMoment = moment.tz(dateKey, TZ).startOf("day");
  const dayStart = dateMoment.toDate();
  const dayEnd = dateMoment.clone().add(1, "day").toDate();

  const { leaveRefundAmount } = await applyLeaveConflictOverride({
    userId,
    worksheetId,
    dateKey,
    checkInTime: computed.newCheckIn,
    checkOutTime: computed.newCheckOut,
    lastShiftEnd: computed.lastShiftEnd,
    session
  });

  const morningStatus = resolvePeriodStatus(computed.morning_absent, computed.statusMissedIn);
  const afternoonStatus = resolvePeriodStatus(computed.afternoon_absent, computed.statusMissedOut);

  await workDayStatusRepository.applyAttendanceDrivenStatus(
    { userId, worksheetId, dayStart, dayEnd, morningStatus, afternoonStatus },
    session
  );

  return { leaveRefundAmount };
}
