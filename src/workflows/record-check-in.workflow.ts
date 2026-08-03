import moment from "moment-timezone";
import UserInfoModel from "../models/UserInfoModel";
import { checkWifiLocation, calculateMinutesLate, hasShiftEnded } from "../modules/attendance";
import { getWorksheetForDay, recordRawPunch } from "../modules/timesheet";
import { ArgumentInvalidException } from "../core/exceptions/exceptions";

const TZ = "Asia/Ho_Chi_Minh";

export interface RecordCheckInInput {
  account: { _id: string };
  ssid?: string;
  latitude?: number;
  longitude?: number;
}

export interface RecordCheckInResult {
  checkIn: Date;
  minutesLate: number;
}

// Chuyển nguyên từ modules/attendance/application/record-check-in.service.ts (task 1.8.5.2) — file gốc
// vi phạm rule #1 mục 13 (module import thẳng module khác: modules/attendance -> modules/timesheet),
// đã ghi rõ "tạm chấp nhận, chờ workflows/ dọn lại" từ 1.8.4.7. Đây chính là bước dọn đó: orchestration
// xuyên Attendance+Timesheet giờ sống ở tầng workflows/ (nơi DUY NHẤT được import ≥2 module), không đổi
// hành vi — chỉ đổi chỗ ở, `checkWifiLocation`/`calculateMinutesLate`/`hasShiftEnded` giờ gọi qua public
// API `modules/attendance` (trước đây gọi trực tiếp trong cùng thư mục module).
//
// Mọi lỗi validate đều ArgumentInvalidException (400) — khớp nguyên vẹn hành vi gốc (xem giải thích đầy
// đủ ở AttendanceController.checkIn trước khi migrate, task 1.8.4.7).
export async function recordCheckIn({
  account,
  ssid,
  latitude,
  longitude
}: RecordCheckInInput): Promise<RecordCheckInResult> {
  await checkWifiLocation({ ssid, latitude, longitude });

  const userInfo = await UserInfoModel.findOne({ id_account: account._id });
  if (!userInfo) throw new ArgumentInvalidException("User info không tồn tại");

  const userId = userInfo._id.toString();
  const today = moment.tz(TZ).startOf("day").toDate();
  const dateKey = moment.tz(today, TZ).format("YYYY-MM-DD");

  const worksheet = await getWorksheetForDay(userId, today);
  if (!worksheet) throw new ArgumentInvalidException("Bạn chưa có ca làm việc hôm nay.");
  if (worksheet.check_in) throw new ArgumentInvalidException("Bạn đã check-in hôm nay rồi.");
  if (!worksheet.shifts?.length) throw new ArgumentInvalidException("Không có ca làm việc hợp lệ.");

  const firstShift = worksheet.shifts[0];
  const lastShift = worksheet.shifts[worksheet.shifts.length - 1];

  const now = new Date();
  if (hasShiftEnded(now, dateKey, lastShift.end_time)) {
    throw new ArgumentInvalidException("Đã quá giờ làm việc, không thể check-in.");
  }

  const minutesLate = calculateMinutesLate(now, dateKey, firstShift.start_time);

  await recordRawPunch({ userId, date: today, checkIn: now, minutesLate });

  return { checkIn: now, minutesLate };
}
