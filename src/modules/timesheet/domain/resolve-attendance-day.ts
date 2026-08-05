import moment from "moment-timezone";
import { Money } from "../../../shared-kernel/money";
import { ForgotInfo, ForgotOccurrenceInfo, PenaltyResolver, WorksheetSnapshot } from "./types";

const TZ = "Asia/Ho_Chi_Minh";
const DEFAULT_SHIFT_START_MINUTES = 480;
const DEFAULT_SHIFT_END_MINUTES = 1020;
const NOON_MINUTES = 720;
const AFTERNOON_START_MINUTES = 780;

function toMinutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function punchClassifyMidpoint(
  worksheet: Pick<WorksheetSnapshot, "shifts">,
  leaveMorning: boolean,
  leaveAfternoon: boolean
): number {
  const shifts = worksheet?.shifts;
  const firstStart = shifts?.[0]?.start_time;
  const lastEnd = shifts?.[shifts.length - 1]?.end_time;
  let start = firstStart ? toMinutesOfDay(firstStart) : DEFAULT_SHIFT_START_MINUTES;
  let end = lastEnd ? toMinutesOfDay(lastEnd) : DEFAULT_SHIFT_END_MINUTES;

  if (leaveMorning) start = Math.max(start, AFTERNOON_START_MINUTES);
  if (leaveAfternoon) end = Math.min(end, NOON_MINUTES);

  return (start + end) / 2;
}

function punchMinutesOfDay(punch: Date | string): number {
  const m = moment.tz(punch, TZ);
  return m.hours() * 60 + m.minutes();
}

export interface NormalizeDayPunchesInput {
  machineIn: Date | null;
  machineOut: Date | null;
  appIn: Date | null;
  appOut: Date | null;
  forgot?: ForgotInfo | null;
  worksheet: Pick<WorksheetSnapshot, "shifts" | "check_in" | "check_out">;
  leaveMorning?: boolean;
  leaveAfternoon?: boolean;
}

export interface NormalizeDayPunchesResult {
  checkIn: Date | null;
  checkOut: Date | null;
}

export function normalizeDayPunches({
  machineIn,
  machineOut,
  appIn,
  appOut,
  forgot,
  worksheet,
  leaveMorning = false,
  leaveAfternoon = false
}: NormalizeDayPunchesInput): NormalizeDayPunchesResult {
  let checkIn: Date | string | null =
    machineIn && appIn
      ? new Date(Math.min(machineIn.getTime(), appIn.getTime()))
      : machineIn || appIn;
  let checkOut: Date | string | null =
    machineOut && appOut
      ? new Date(Math.max(machineOut.getTime(), appOut.getTime()))
      : machineOut || appOut;

  if (forgot) {
    if (forgot.type === "check_in" || forgot.type === "both") checkIn = worksheet?.check_in;
    if (forgot.type === "check_out" || forgot.type === "both") checkOut = worksheet?.check_out;
  }

  if (checkIn && checkOut && new Date(checkOut) <= new Date(checkIn)) {
    checkIn = new Date(Math.min(new Date(checkIn).getTime(), new Date(checkOut).getTime()));
    checkOut = null;
  }

  if (!forgot && !!checkIn !== !!checkOut) {
    const midpoint = punchClassifyMidpoint(worksheet, leaveMorning, leaveAfternoon);
    const single = checkIn || checkOut;
    const isAfterMidpoint = punchMinutesOfDay(single as Date | string) > midpoint;
    checkIn = isAfterMidpoint ? null : single;
    checkOut = isAfterMidpoint ? single : null;
  }

  return {
    checkIn: checkIn ? new Date(checkIn) : null,
    checkOut: checkOut ? new Date(checkOut) : null
  };
}

export interface ResolveAttendanceDayInput {
  dateKey: string;
  rawIn: string | null;
  rawOut: string | null;
  worksheet: WorksheetSnapshot;
  forgotMap: Map<string, ForgotInfo>;
  forgotOccurrenceMap?: Map<string, ForgotOccurrenceInfo>;
  lateForgivenSet: Set<string>;
  earlyForgivenSet: Set<string>;
  leavePeriodsMap?: Map<string, Set<string>>;
  resolveLatePenalty: PenaltyResolver;
  resolveEarlyPenalty: PenaltyResolver;
  resolveForgotPenalty: PenaltyResolver;
}

export interface ResolveAttendanceDaySkipped {
  skip: true;
}

export interface ResolveAttendanceDayComputed {
  skip: false;
  unchanged: boolean;
  newCheckIn: Date | null;
  newCheckOut: Date | null;
  minutesLate: number;
  minutesEarly: number;
  work_unit: number;
  penalty_amount: number;
  morning_absent: boolean;
  afternoon_absent: boolean;
  hasIn: boolean;
  hasOut: boolean;
  missedIn: boolean;
  missedOut: boolean;
  statusMissedIn: boolean;
  statusMissedOut: boolean;
  lastShiftEnd: string | null;
}

export type ResolveAttendanceDayResult = ResolveAttendanceDaySkipped | ResolveAttendanceDayComputed;

export function resolveAttendanceDay({
  dateKey,
  rawIn,
  rawOut,
  worksheet,
  forgotMap,
  forgotOccurrenceMap,
  lateForgivenSet,
  earlyForgivenSet,
  leavePeriodsMap,
  resolveLatePenalty,
  resolveEarlyPenalty,
  resolveForgotPenalty
}: ResolveAttendanceDayInput): ResolveAttendanceDayResult {
  const forgot = forgotMap.get(dateKey);

  if (!rawIn && !rawOut && !forgot) return { skip: true };
  if (!worksheet) return { skip: true };

  const dateMoment = moment.tz(dateKey, TZ).startOf("day");
  const dayStart = dateMoment.toDate();

  const machineIn = rawIn
    ? moment.tz(`${dateKey} ${rawIn}`, "YYYY-MM-DD HH:mm", TZ).toDate()
    : null;
  const machineOut = rawOut
    ? moment.tz(`${dateKey} ${rawOut}`, "YYYY-MM-DD HH:mm", TZ).toDate()
    : null;

  const appIn = worksheet.check_in ? new Date(worksheet.check_in) : null;
  const appOut = worksheet.check_out ? new Date(worksheet.check_out) : null;

  const leavePeriods = leavePeriodsMap?.get(dateKey);
  let leaveMorning = !!leavePeriods && (leavePeriods.has("morning") || leavePeriods.has("full"));
  let leaveAfternoon =
    !!leavePeriods && (leavePeriods.has("afternoon") || leavePeriods.has("full"));

  const { checkIn: newCheckIn, checkOut: newCheckOut } = normalizeDayPunches({
    machineIn,
    machineOut,
    appIn,
    appOut,
    forgot,
    worksheet,
    leaveMorning,
    leaveAfternoon
  });

  const hasIn = !!newCheckIn;
  const hasOut = !!newCheckOut;
  if (!hasIn && !hasOut) return { skip: true };

  const isSaturday = dateMoment.day() === 6;
  const forgiven = lateForgivenSet.has(dateKey);

  let lastShiftEnd: string | null = null;
  if (worksheet.shifts?.length) {
    const lastShift = worksheet.shifts[worksheet.shifts.length - 1];
    lastShiftEnd = lastShift?.end_time ?? null;
  }
  if (hasIn && hasOut) {
    if (leaveMorning) {
      const noon = moment.tz(dateKey, TZ).hour(12).minute(0).second(0);
      if (moment.tz(newCheckIn as Date, TZ).isBefore(noon)) leaveMorning = false;
    }
    if (leaveAfternoon && lastShiftEnd) {
      const [endH, endM] = lastShiftEnd.split(":").map(Number);
      const threshold = moment
        .tz(dateKey, TZ)
        .hour(endH)
        .minute(endM)
        .second(0)
        .subtract(60, "minutes");
      if (moment.tz(newCheckOut as Date, TZ).isSameOrAfter(threshold)) leaveAfternoon = false;
    }
  }
  const leaveDeduction = Math.min(
    isSaturday ? 0.5 : 1,
    (leaveMorning ? 0.5 : 0) + (leaveAfternoon ? 0.5 : 0)
  );
  const missedIn = !hasIn && !leaveMorning;
  const missedOut = !hasOut && !leaveAfternoon;
  const forgotCoversIn = !!forgot && (forgot.type === "check_in" || forgot.type === "both");
  const forgotCoversOut = !!forgot && (forgot.type === "check_out" || forgot.type === "both");
  const statusMissedIn = missedIn || forgotCoversIn;
  const statusMissedOut = missedOut || forgotCoversOut;

  let minutesLate = 0;
  const firstShift = worksheet.shifts && worksheet.shifts[0];
  if (hasIn && !leaveMorning && firstShift && firstShift.start_time) {
    const [sh, sm] = firstShift.start_time.split(":").map(Number);
    const shiftStart = moment.tz(dateKey, TZ).hour(sh).minute(sm).second(0);
    minutesLate = Math.max(
      0,
      Math.floor((moment.tz(newCheckIn as Date, TZ).valueOf() - shiftStart.valueOf()) / 60000)
    );
  }

  let minutesEarly = 0;
  if (hasOut && !leaveAfternoon && lastShiftEnd) {
    const [eh, em] = lastShiftEnd.split(":").map(Number);
    const shiftEnd = moment.tz(dateKey, TZ).hour(eh).minute(em).second(0);
    minutesEarly = Math.max(
      0,
      Math.floor((shiftEnd.valueOf() - moment.tz(newCheckOut as Date, TZ).valueOf()) / 60000)
    );
  }
  const earlyForgiven = earlyForgivenSet.has(dateKey);

  const penaltyLateMinutes = forgiven ? 0 : minutesLate;
  const penaltyEarlyMinutes = earlyForgiven ? 0 : minutesEarly;

  let work_unit: number;
  let penalty_amount = 0;
  let morning_absent = false;
  let afternoon_absent = false;
  if (missedIn || missedOut || forgot) {
    const occInfo = forgotOccurrenceMap?.get(dateKey);
    const hasRequest = occInfo ? occInfo.hasRequest : !!forgot;
    const base = isSaturday ? 0.5 : 1;
    const r = resolveForgotPenalty(dayStart, occInfo?.occurrence || 0, isSaturday);
    work_unit = Math.max(0, (hasRequest ? r.work_unit : base / 2) - leaveDeduction);
    penalty_amount = r.penalty_amount;
  } else {
    const lateResult = resolveLatePenalty(dayStart, penaltyLateMinutes, isSaturday);
    const earlyResult = resolveEarlyPenalty(dayStart, penaltyEarlyMinutes, isSaturday);
    work_unit = Math.max(0, Math.min(lateResult.work_unit, earlyResult.work_unit) - leaveDeduction);
    penalty_amount = Money.of(lateResult.penalty_amount)
      .add(Money.of(earlyResult.penalty_amount))
      .toNumber();
    morning_absent = lateResult.morning_absent ?? false;
    afternoon_absent = earlyResult.afternoon_absent ?? false;
  }

  const sameTime = (a: unknown, b: unknown) =>
    (a ? new Date(a as string).getTime() : null) === (b ? new Date(b as string).getTime() : null);
  const unchanged =
    sameTime(worksheet.check_in, newCheckIn) &&
    sameTime(worksheet.check_out, newCheckOut) &&
    (worksheet.minutes_late ?? 0) === minutesLate &&
    (worksheet.minute_early ?? 0) === minutesEarly &&
    (worksheet.work_unit ?? null) === work_unit &&
    (worksheet.penalty_amount ?? 0) === penalty_amount;

  return {
    skip: false,
    unchanged,
    newCheckIn,
    newCheckOut,
    minutesLate,
    minutesEarly,
    work_unit,
    penalty_amount,
    morning_absent,
    afternoon_absent,
    hasIn,
    hasOut,
    missedIn,
    missedOut,
    statusMissedIn,
    statusMissedOut,
    lastShiftEnd
  };
}
