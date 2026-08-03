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

// Ghi/tạo mới field punch thô (check_in/check_out, và tùy chọn minutes_late/minute_early kiểu
// "optimistic real-time" — xem modules/attendance/domain/naive-punch-timing.ts) cho 1 ngày — dùng khi
// caller (vd luồng duyệt đơn quên chấm công, hoặc check-in/check-out route ở modules/attendance) đã tự
// quyết định giá trị cần ghi (business rule "cứu giờ ra về bị đọc nhầm" v.v. thuộc về caller, đây chỉ
// là plumbing ghi dữ liệu thô, không có invariant nghiệp vụ riêng).
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
