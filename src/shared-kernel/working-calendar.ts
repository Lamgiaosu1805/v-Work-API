// Lịch làm việc dùng để tính mốc theo PHÚT LÀM VIỆC: SLA chăm sóc khách (Quy định 183A, Điều 7) và
// cảnh báo/tự đóng của ticket hỗ trợ. Thuần domain: không đọc DB, ngày lễ được truyền vào dưới dạng
// dateKey "YYYY-MM-DD". Dùng chung nhiều module nên nằm ở shared-kernel.
//
// Mọi phép tính quy đổi về giờ Việt Nam bằng offset cố định +07:00 (VN không có giờ mùa hè), để kết
// quả không phụ thuộc múi giờ của process (test chạy UTC, server chạy Asia/Ho_Chi_Minh).

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface WorkingWindow {
  startMinute: number;
  endMinute: number;
}

export interface WorkingCalendarConfig {
  /** Phút bắt đầu ca trong ngày (giờ VN), vd 8:00 = 480 */
  workStartMinute: number;
  /** Phút kết thúc ca trong ngày (giờ VN), vd 17:00 = 1020 */
  workEndMinute: number;
  /** Thứ làm việc theo getUTCDay của giờ VN: 0=CN ... 6=T7 */
  workDays: number[];
  /**
   * Khung giờ RIÊNG theo thứ (key như `workDays`), ghi đè workStartMinute/workEndMinute cho thứ đó —
   * vd T7 chỉ làm buổi sáng: `{ 6: { startMinute: 480, endMinute: 720 } }`. Thứ không có trong
   * `workDays` vẫn là ngày nghỉ dù có khai báo ở đây.
   */
  dayWindows?: Partial<Record<number, WorkingWindow>>;
  /** Ngày nghỉ lễ dạng "YYYY-MM-DD" theo giờ VN */
  holidays: string[];
}

export const DEFAULT_WORKING_CALENDAR: WorkingCalendarConfig = {
  workStartMinute: 8 * 60,
  workEndMinute: 17 * 60,
  workDays: [1, 2, 3, 4, 5],
  holidays: []
};

function toVnShifted(date: Date): Date {
  return new Date(date.getTime() + VN_OFFSET_MS);
}

function fromVnShifted(shifted: Date): Date {
  return new Date(shifted.getTime() - VN_OFFSET_MS);
}

export function toVnDateKey(date: Date): string {
  return toVnShifted(date).toISOString().slice(0, 10);
}

function minuteOfVnDay(date: Date): number {
  const shifted = toVnShifted(date);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** 00:00 giờ VN của ngày chứa `date`, trả về dưới dạng Date thật (UTC). */
export function startOfVnDay(date: Date): Date {
  const shifted = toVnShifted(date);
  shifted.setUTCHours(0, 0, 0, 0);
  return fromVnShifted(shifted);
}

export class WorkingCalendar {
  private readonly config: WorkingCalendarConfig;

  private readonly holidaySet: Set<string>;

  constructor(config: Partial<WorkingCalendarConfig> = {}) {
    this.config = { ...DEFAULT_WORKING_CALENDAR, ...config };
    if (this.config.workEndMinute <= this.config.workStartMinute) {
      throw new Error("WorkingCalendar: giờ kết thúc phải sau giờ bắt đầu");
    }
    Object.values(this.config.dayWindows ?? {}).forEach((window) => {
      if (window && window.endMinute <= window.startMinute) {
        throw new Error("WorkingCalendar: giờ kết thúc phải sau giờ bắt đầu");
      }
    });
    this.holidaySet = new Set(this.config.holidays);
  }

  /** Khung giờ làm việc của ngày chứa `date` (giờ VN); không kiểm tra ngày nghỉ. */
  private windowOf(date: Date): WorkingWindow {
    const override = this.config.dayWindows?.[toVnShifted(date).getUTCDay()];
    return (
      override ?? {
        startMinute: this.config.workStartMinute,
        endMinute: this.config.workEndMinute
      }
    );
  }

  isWorkingDay(date: Date): boolean {
    const shifted = toVnShifted(date);
    return (
      this.config.workDays.includes(shifted.getUTCDay()) &&
      !this.holidaySet.has(shifted.toISOString().slice(0, 10))
    );
  }

  isWorkingTime(date: Date): boolean {
    if (!this.isWorkingDay(date)) return false;
    const minute = minuteOfVnDay(date);
    const window = this.windowOf(date);
    return minute >= window.startMinute && minute < window.endMinute;
  }

  /** Thời điểm làm việc gần nhất kể từ `date` (chính `date` nếu đang trong giờ làm). */
  nextWorkingStart(date: Date): Date {
    if (this.isWorkingTime(date)) return new Date(date);

    let dayStart = startOfVnDay(date);
    const minute = minuteOfVnDay(date);
    if (this.isWorkingDay(date) && minute < this.windowOf(date).startMinute) {
      return new Date(dayStart.getTime() + this.windowOf(date).startMinute * MINUTE_MS);
    }

    // Sau giờ làm hoặc ngày nghỉ → đầu ca ngày làm việc kế tiếp (giới hạn 366 ngày để tránh lặp vô hạn)
    for (let i = 0; i < 366; i += 1) {
      dayStart = new Date(dayStart.getTime() + DAY_MS);
      if (this.isWorkingDay(dayStart)) {
        return new Date(dayStart.getTime() + this.windowOf(dayStart).startMinute * MINUTE_MS);
      }
    }
    throw new Error("WorkingCalendar: không tìm thấy ngày làm việc trong 366 ngày tới");
  }

  /** Cộng `minutes` phút làm việc vào `from` (đồng hồ dừng ngoài giờ, cuối tuần, ngày lễ). */
  addWorkingMinutes(from: Date, minutes: number): Date {
    if (minutes < 0) throw new Error("WorkingCalendar: số phút phải >= 0");
    let cursor = this.nextWorkingStart(from);
    let remaining = minutes;

    while (remaining > 0) {
      const endOfShift = new Date(
        startOfVnDay(cursor).getTime() + this.windowOf(cursor).endMinute * MINUTE_MS
      );
      const available = Math.floor((endOfShift.getTime() - cursor.getTime()) / MINUTE_MS);
      if (remaining <= available) {
        return new Date(cursor.getTime() + remaining * MINUTE_MS);
      }
      remaining -= available;
      cursor = this.nextWorkingStart(endOfShift);
    }
    return cursor;
  }

  /** Số phút làm việc giữa `from` và `to` (0 nếu to <= from). */
  workingMinutesBetween(from: Date, to: Date): number {
    if (to.getTime() <= from.getTime()) return 0;
    let cursor = this.nextWorkingStart(from);
    let total = 0;
    while (cursor.getTime() < to.getTime()) {
      const endOfShift = new Date(
        startOfVnDay(cursor).getTime() + this.windowOf(cursor).endMinute * MINUTE_MS
      );
      const segmentEnd = Math.min(endOfShift.getTime(), to.getTime());
      total += Math.floor((segmentEnd - cursor.getTime()) / MINUTE_MS);
      if (segmentEnd >= to.getTime()) break;
      cursor = this.nextWorkingStart(endOfShift);
    }
    return total;
  }
}
