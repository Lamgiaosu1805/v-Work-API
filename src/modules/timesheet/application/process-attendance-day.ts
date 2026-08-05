import { ClientSession } from "mongoose";
import { resolveAttendanceDay, ResolveAttendanceDayInput } from "../domain/resolve-attendance-day";
import { persistAttendanceDay } from "./persist-attendance-day";

export interface ProcessAttendanceDayInput extends ResolveAttendanceDayInput {
  userId: string;
  worksheetId: string;
  session?: ClientSession;
}

export interface ProcessAttendanceDayResult {
  skip: boolean;
  unchanged?: boolean;
  leaveRefundAmount?: number;
}

export async function processAttendanceDay({
  userId,
  worksheetId,
  session,
  ...resolveInput
}: ProcessAttendanceDayInput): Promise<ProcessAttendanceDayResult> {
  const computed = resolveAttendanceDay(resolveInput);
  if (computed.skip) return { skip: true };

  const persistResult = await persistAttendanceDay({
    userId,
    worksheetId,
    dateKey: resolveInput.dateKey,
    computed,
    session
  });

  return {
    skip: false,
    unchanged: computed.unchanged,
    leaveRefundAmount: persistResult.leaveRefundAmount
  };
}
