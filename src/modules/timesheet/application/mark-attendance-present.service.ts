import { ClientSession } from "mongoose";
import { WorkDayStatusRepository } from "../infrastructure/work-day-status.repository";

const workDayStatusRepository = new WorkDayStatusRepository();

// Thin wrapper cho WorkDayStatusRepository.markPendingAsPresent (task 1.8.4.8) — expose qua public API
// module thay vì để caller ngoài (modules/attendance) đụng thẳng repository nội bộ.
export async function markAttendancePresent(
  worksheetId: string,
  session?: ClientSession
): Promise<void> {
  return workDayStatusRepository.markPendingAsPresent(worksheetId, session);
}
