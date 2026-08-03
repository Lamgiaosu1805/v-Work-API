import { ClientSession } from "mongoose";
import { WorkSheetRepository, WorkSheetRecord } from "../infrastructure/work-sheet.repository";

export type { WorkSheetRecord };

const workSheetRepository = new WorkSheetRepository();

export async function getWorksheetForDay(
  userId: string,
  date: Date,
  session?: ClientSession
): Promise<WorkSheetRecord | null> {
  return workSheetRepository.findByUserAndDate(userId, date, session);
}
