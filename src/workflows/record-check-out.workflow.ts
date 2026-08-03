import moment from "moment-timezone";
import UserInfoModel from "../models/UserInfoModel";
import { checkWifiLocation, calculateMinutesEarly } from "../modules/attendance";
import {
  getWorksheetForDay,
  recordRawPunch,
  applyLeaveConflictOverride,
  markAttendancePresent
} from "../modules/timesheet";
import { adjustLeaveBalance } from "../modules/leave";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";
import { runInTransaction } from "../core/db/run-in-transaction";
import { LEAVE_BALANCE_REASON } from "../constants";

const TZ = "Asia/Ho_Chi_Minh";

export interface RecordCheckOutInput {
  account: { _id: string };
  ssid?: string;
  latitude?: number;
  longitude?: number;
}

export interface RecordCheckOutResult {
  checkOut: Date;
  minuteEarly: number;
}

// Chuyển nguyên từ modules/attendance/application/record-check-out.service.ts (task 1.8.5.3) — cùng lý
// do đã ghi ở record-check-in.workflow.ts (1.8.5.2): file gốc vi phạm rule #1 mục 13 (module import
// thẳng module khác: modules/attendance -> modules/timesheet + modules/leave), đã ghi rõ "tạm chấp
// nhận, chờ workflows/ dọn lại" từ 1.8.4.8. Đây chính là bước dọn đó — orchestration xuyên Attendance+
// Timesheet+Leave giờ sống ở tầng workflows/ (nơi DUY NHẤT được import ≥2 module), không đổi hành vi,
// vẫn dùng nguyên `runInTransaction` (core/db, Phase 0) để bọc write xuyên collection.
//
// Mọi lỗi validate đều ArgumentInvalidException (400) — khớp nguyên vẹn hành vi gốc.
export async function recordCheckOut({
  account,
  ssid,
  latitude,
  longitude
}: RecordCheckOutInput): Promise<RecordCheckOutResult> {
  await checkWifiLocation({ ssid, latitude, longitude });

  const userInfo = await UserInfoModel.findOne({ id_account: account._id });
  if (!userInfo) throw new ArgumentInvalidException("User info không tồn tại");

  const userId = userInfo._id.toString();
  const today = moment.tz(TZ).startOf("day").toDate();
  const dateKey = moment.tz(today, TZ).format("YYYY-MM-DD");

  const worksheet = await getWorksheetForDay(userId, today);
  if (!worksheet) {
    throw new ArgumentInvalidException("Bạn chưa có ca làm việc hôm nay, không thể check-out.");
  }
  if (worksheet.check_out) throw new ArgumentInvalidException("Bạn đã check-out hôm nay rồi.");
  if (!worksheet.shifts?.length) throw new ArgumentInvalidException("Không có ca làm việc hợp lệ.");

  const lastShift = worksheet.shifts[worksheet.shifts.length - 1];
  const now = new Date();
  const minuteEarly = calculateMinutesEarly(now, dateKey, lastShift.end_time);

  await runInTransaction(async (session) => {
    await recordRawPunch({ userId, date: today, checkOut: now, minuteEarly, session });

    const { leaveRefundAmount } = await applyLeaveConflictOverride({
      userId,
      worksheetId: worksheet.id,
      dateKey,
      // .lean() luôn trả Date thật cho field Date của Mongoose (không phải string) — WorksheetSnapshot
      // khai union rộng hơn cho những nơi khác của module, ép kiểu đúng thực tế tại đây.
      checkInTime: worksheet.check_in as Date | null,
      checkOutTime: now,
      lastShiftEnd: lastShift.end_time,
      session
    });
    if (leaveRefundAmount > 0) {
      await adjustLeaveBalance({
        userId,
        amount: leaveRefundAmount,
        reason: LEAVE_BALANCE_REASON.ATTENDANCE_OVERRIDE_REFUND,
        refId: worksheet.id,
        refType: "system",
        allowNegative: true,
        session
      });
    }

    await markAttendancePresent(worksheet.id, session);
  });

  return { checkOut: now, minuteEarly };
}
