import moment from "moment-timezone";
import { DateKey } from "../../../shared-kernel/date-key";

// Lịch báo cáo ngày (docs/CRM-DAILY-REPORT-FLOWS.md mục 5, Q9–Q10): T2–T7, trừ ngày lễ;
// kế hoạch hạn 09:30, kết quả hạn 17:30; nộp sau hạn trong ngày = trễ, qua ngày = thiếu.

export const REPORT_TZ = "Asia/Ho_Chi_Minh";

export const REPORT_DEADLINES = { plan: "09:30", result: "17:30" } as const;
export type ReportKind = keyof typeof REPORT_DEADLINES;

// moment isoWeekday: 1 = thứ Hai … 7 = Chủ nhật
const REPORT_ISO_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6]);

export interface DateRange {
  from: Date; // gồm
  to: Date; // không gồm
}

const startOf = (key: string) => moment.tz(key, "YYYY-MM-DD", REPORT_TZ);

export function toDateKey(date: Date): string {
  return DateKey.from(date).toString();
}

/** Kiểm tra chuỗi YYYY-MM-DD, ném ArgumentInvalidException nếu sai. */
export function parseDateKey(value: string): string {
  return DateKey.of(value).toString();
}

export function addDays(key: string, days: number): string {
  return startOf(key).add(days, "day").format("YYYY-MM-DD");
}

export function dayRange(key: string): DateRange {
  const start = startOf(key);
  return { from: start.toDate(), to: start.clone().add(1, "day").toDate() };
}

/** Ngày đang xem, lũy kế tháng, lũy kế năm — đều tính đến hết ngày `key`. */
export function periodRanges(key: string): { day: DateRange; month: DateRange; year: DateRange } {
  const start = startOf(key);
  const to = start.clone().add(1, "day").toDate();
  return {
    day: { from: start.toDate(), to },
    month: { from: start.clone().startOf("month").toDate(), to },
    year: { from: start.clone().startOf("year").toDate(), to }
  };
}

export function monthOf(key: string): number {
  return startOf(key).month() + 1;
}

export function yearOf(key: string): number {
  return startOf(key).year();
}

export function endOfMonthKey(key: string): string {
  return startOf(key).endOf("month").format("YYYY-MM-DD");
}

export function deadlineOf(key: string, kind: ReportKind): Date {
  const [hour, minute] = REPORT_DEADLINES[kind].split(":").map(Number);
  return startOf(key).hour(hour).minute(minute).second(0).millisecond(0).toDate();
}

export function isReportDay(key: string, holidays: ReadonlySet<string>): boolean {
  return REPORT_ISO_WEEKDAYS.has(startOf(key).isoWeekday()) && !holidays.has(key);
}

/** Các ngày phải báo cáo trong đoạn [fromKey, toKey] (gồm 2 đầu). */
export function reportDaysBetween(
  fromKey: string,
  toKey: string,
  holidays: ReadonlySet<string>
): string[] {
  const days: string[] = [];
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) {
    if (isReportDay(key, holidays)) days.push(key);
  }
  return days;
}

// on_time: nộp đúng hạn · late: nộp sau hạn · overdue: chưa nộp, đã quá hạn nhưng còn trong ngày
// pending: chưa nộp, chưa tới hạn · missing: qua ngày chưa nộp · not_required: không phải nộp
export type SubmissionStatus =
  | "on_time"
  | "late"
  | "overdue"
  | "pending"
  | "missing"
  | "not_required";

export function submissionStatus(input: {
  submittedAt: Date | null;
  dateKey: string;
  kind: ReportKind;
  now: Date;
  required: boolean;
}): SubmissionStatus {
  const deadline = deadlineOf(input.dateKey, input.kind);
  if (input.submittedAt) {
    return input.submittedAt.getTime() <= deadline.getTime() ? "on_time" : "late";
  }
  if (!input.required) return "not_required";
  if (input.now.getTime() >= dayRange(input.dateKey).to.getTime()) return "missing";
  return input.now.getTime() > deadline.getTime() ? "overdue" : "pending";
}

export type TrendGranularity = "week" | "month";

export interface PeriodBucket {
  key: string; // ngày đầu kỳ YYYY-MM-DD
  label: string;
  fromKey: string;
  toKey: string; // ngày cuối kỳ (kỳ cuối = ngày đang xem)
  range: DateRange;
}

// Tuần báo cáo kinh doanh: thứ Sáu tuần trước → thứ Năm tuần này (moment: thứ Sáu = 5)
const REPORT_WEEK_START_DAY = 5;

/**
 * `count` kỳ liên tiếp (tuần báo cáo thứ Sáu → thứ Năm / tháng dương lịch), kỳ cuối là kỳ chứa `toKey` và tính tới
 * hết ngày đó.
 */
export function bucketsEndingAt(
  toKey: string,
  granularity: TrendGranularity,
  count: number
): PeriodBucket[] {
  const end = startOf(toKey);
  const weekStart = end.clone().subtract((end.day() - REPORT_WEEK_START_DAY + 7) % 7, "day");
  const buckets: PeriodBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start =
      granularity === "week"
        ? weekStart.clone().subtract(i * 7, "day")
        : end.clone().subtract(i, "month").startOf("month");
    const naturalEnd =
      granularity === "week"
        ? start.clone().add(6, "day")
        : start.clone().endOf("month").startOf("day");
    const last = naturalEnd.isAfter(end) ? end : naturalEnd;
    const fromKey = start.format("YYYY-MM-DD");
    const lastKey = last.format("YYYY-MM-DD");
    buckets.push({
      key: fromKey,
      label:
        granularity === "week"
          ? `${start.format("DD/MM")}–${last.format("DD/MM")}`
          : start.format("MM/YYYY"),
      fromKey,
      toKey: lastKey,
      range: { from: start.toDate(), to: startOf(lastKey).add(1, "day").toDate() }
    });
  }
  return buckets;
}
