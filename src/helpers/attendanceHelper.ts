import moment from "moment-timezone";
import xlsx from "xlsx";
import { DECISION_DRIVEN_STATUSES } from "./workDayStatusRules";

const TZ = "Asia/Ho_Chi_Minh";
const EMPLOYEE_HEADER_REGEX = /Mã nhân viên:\s*(\S+)/;
const DATE_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;
const TIME_REGEX = /^\d{2}:\d{2}/;

export function parseExcelToBlocks(buffer: Buffer) {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const headers: { machine_code: string; startRow: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const match = String(rows[i][0] || "").match(EMPLOYEE_HEADER_REGEX);
    if (match) headers.push({ machine_code: match[1], startRow: i });
  }

  return headers.map((h, idx) => {
    const nextStart = idx + 1 < headers.length ? headers[idx + 1].startRow : rows.length;
    return {
      machine_code: h.machine_code,
      rows: rows.slice(h.startRow + 1, nextStart)
    };
  });
}

export function parseDayRows(block: { rows: any[][] }) {
  const dayRows: { dateStr: string; rawIn: string | null; rawOut: string | null }[] = [];
  for (const row of block.rows) {
    const dateStr = String(row[0] || "").trim();
    if (!DATE_REGEX.test(dateStr)) continue;
    const inCell = [row[2], row[4], row[6]].find((v) => TIME_REGEX.test(String(v).trim()));
    const outCell = [row[7], row[5], row[3]].find((v) => TIME_REGEX.test(String(v).trim()));
    dayRows.push({
      dateStr,
      rawIn: inCell ? String(inCell).trim().slice(0, 5) : null,
      rawOut: outCell ? String(outCell).trim().slice(0, 5) : null
    });
  }
  return dayRows;
}

const DEFAULT_SHIFT_START_MINUTES = 480;
const DEFAULT_SHIFT_END_MINUTES = 1020;
const NOON_MINUTES = 720;
const AFTERNOON_START_MINUTES = 780;

function toMinutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function punchClassifyMidpoint(
  worksheet: any,
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
  forgot?: { type: string } | null;
  worksheet: any;
  leaveMorning?: boolean;
  leaveAfternoon?: boolean;
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
}: NormalizeDayPunchesInput) {
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

export function correctDayStatuses(statuses: any[], ws: any): any[] {
  const hasCheckIn = !!ws?.check_in;
  const hasCheckOut = !!ws?.check_out;
  if (!hasCheckIn && !hasCheckOut) return statuses;

  return statuses.map((s) => {
    if ((DECISION_DRIVEN_STATUSES as string[]).includes(s.status)) return s;

    let periodHasData;
    if (s.period === "morning") periodHasData = hasCheckIn;
    else if (s.period === "afternoon") periodHasData = hasCheckOut;
    else periodHasData = hasCheckIn && hasCheckOut;

    if (!periodHasData && s.status !== "missed_clock") return { ...s, status: "missed_clock" };
    if (periodHasData && s.status === "absent") return { ...s, status: "present" };
    return s;
  });
}
