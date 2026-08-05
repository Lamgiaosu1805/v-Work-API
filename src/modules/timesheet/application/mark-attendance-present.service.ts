import { ClientSession } from "mongoose";
import { WorkDayStatusRepository } from "../infrastructure/work-day-status.repository";

const workDayStatusRepository = new WorkDayStatusRepository();

export async function markAttendancePresent(
  worksheetId: string,
  session?: ClientSession
): Promise<void> {
  return workDayStatusRepository.markPendingAsPresent(worksheetId, session);
}
