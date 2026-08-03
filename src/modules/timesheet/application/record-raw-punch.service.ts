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
  session?: ClientSession;
}

// Ghi/tạo mới field punch thô (check_in/check_out) cho 1 ngày — dùng khi caller (vd luồng duyệt đơn
// quên chấm công, hoặc check-in/check-out route ở modules/attendance sau này) đã tự quyết định giá
// trị check_in/check_out cần ghi (business rule "cứu giờ ra về bị đọc nhầm" v.v. thuộc về caller, đây
// chỉ là plumbing ghi dữ liệu thô, không có invariant nghiệp vụ riêng).
export async function recordRawPunch({
  userId,
  date,
  checkIn,
  checkOut,
  session
}: RecordRawPunchInput): Promise<WorkSheetRecord> {
  const clockUpdate: RawPunchUpdate = {};
  if (checkIn) clockUpdate.check_in = checkIn;
  if (checkOut) clockUpdate.check_out = checkOut;
  return workSheetRepository.upsertRawPunch(userId, date, clockUpdate, session);
}
