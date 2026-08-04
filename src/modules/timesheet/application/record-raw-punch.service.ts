import { ClientSession } from "mongoose";
import {
  WorkSheetRepository,
  WorkSheetRecord,
  RawPunchUpdate
} from "../infrastructure/work-sheet.repository";

export type { WorkSheetRecord, RawPunchUpdate };

const workSheetRepository = new WorkSheetRepository();

export interface RecordRawPunchInput {
  userId: string;
  date: Date;
  checkIn?: Date;
  checkOut?: Date;
  minutesLate?: number;
  minuteEarly?: number;
  session?: ClientSession;
}

export async function recordRawPunch({
  userId,
  date,
  checkIn,
  checkOut,
  minutesLate,
  minuteEarly,
  session
}: RecordRawPunchInput): Promise<WorkSheetRecord> {
  const clockUpdate: RawPunchUpdate = {};
  if (checkIn) clockUpdate.check_in = checkIn;
  if (checkOut) clockUpdate.check_out = checkOut;
  if (minutesLate !== undefined) clockUpdate.minutes_late = minutesLate;
  if (minuteEarly !== undefined) clockUpdate.minute_early = minuteEarly;
  return workSheetRepository.upsertRawPunch(userId, date, clockUpdate, session);
}
