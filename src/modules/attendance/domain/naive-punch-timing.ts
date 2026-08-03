import moment from "moment-timezone";

const TZ = "Asia/Ho_Chi_Minh";

// "Optimistic real-time" — tính nhanh lúc check-in/check-out, KHÁC bản tính đầy đủ theo tier phạt của
// `resolveAttendanceDay` (modules/timesheet, chạy lúc finalize/import). Port nguyên công thức đang
// lặp lại ở checkIn/checkOut (AttendanceController.js) — chỉ so với giờ ca, không áp tier phạt.
function toMomentOnDate(dateKey: string, hhmm: string): moment.Moment {
  const [h, m] = hhmm.split(":").map(Number);
  return moment.tz(dateKey, TZ).hour(h).minute(m).second(0).millisecond(0);
}

export function calculateMinutesLate(now: Date, dateKey: string, shiftStartTime: string): number {
  const shiftStart = toMomentOnDate(dateKey, shiftStartTime);
  return Math.max(0, Math.floor((moment.tz(now, TZ).valueOf() - shiftStart.valueOf()) / 60000));
}

export function calculateMinutesEarly(now: Date, dateKey: string, shiftEndTime: string): number {
  const shiftEnd = toMomentOnDate(dateKey, shiftEndTime);
  return Math.max(0, Math.floor((shiftEnd.valueOf() - moment.tz(now, TZ).valueOf()) / 60000));
}

// Port nguyên guard "quá giờ làm việc, không thể check-in" đang lặp ở checkIn (AttendanceController.js).
export function hasShiftEnded(now: Date, dateKey: string, shiftEndTime: string): boolean {
  const shiftEnd = toMomentOnDate(dateKey, shiftEndTime);
  return moment.tz(now, TZ).isAfter(shiftEnd);
}
