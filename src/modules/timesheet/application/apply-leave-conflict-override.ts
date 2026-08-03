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
  // Số ngày phép cần hoàn lại — caller chịu trách nhiệm gọi modules/leave's adjustLeaveBalance với số
  // này (nếu > 0), cho tới khi có workflows/ (1.8.5) chính thức hoá điều phối liên module này. Xem
  // quyết định tách resolveLeaveConflictOnAttendance ở đầu mục 1.8.3.
  leaveRefundAmount: number;
}

// Trích xuất từ `persistAttendanceDay` (task 1.8.3.6, khi cutover `checkOut` route) — dùng chung cho
// cả luồng `resolveAttendanceDay` đầy đủ (finalizeWorkDay/import/duyệt đơn) LẪN luồng optimistic
// real-time (checkOut route, KHÔNG đi qua resolveAttendanceDay/processAttendanceDay). Đọc leave
// status của ngày, tính override + refund (domain thuần), áp dụng flip status — KHÔNG tự gọi
// adjustLeaveBalance (module Leave), trả `leaveRefundAmount` cho caller tự quyết định.
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
