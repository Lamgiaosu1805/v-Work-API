import moment from "moment-timezone";
import { ClientSession } from "mongoose";
import WorkSheetModel from "../models/WorkSheetModel";
import WorkDayStatusModel from "../models/WorkDayStatusModel";
import { RequestModel } from "../models/RequestModel";
import { normalizeDayPunches } from "../helpers/attendanceHelper";
import {
  buildUnifiedForgotOccurrenceMap,
  ForgotDaySnapshot,
  ForgotOccurrenceEntry
} from "../modules/timesheet";

const TZ = "Asia/Ho_Chi_Minh";
const LEAVE_STATUSES = ["leave_paid", "leave_unpaid", "remote"];

export interface ExcelRawPunch {
  rawIn: string | null;
  rawOut: string | null;
}

export interface BuildAttendanceContextInput {
  userId: string;
  rangeStart: Date;
  rangeEnd: Date;
  periodStart: Date;
  periodEnd: Date;
  // Chỉ importExcel truyền vào (dữ liệu máy chấm công thô đọc từ file) — finalizeWorkDay không có nên
  // để mặc định rỗng, khiến daySnapshots chỉ dựa vào worksheet đã ghi (app), khớp đúng hành vi gốc của
  // buildUserDayContext (jobs/finalizeWorkDay.js).
  excelRawByDate?: Map<string, ExcelRawPunch>;
  session?: ClientSession;
}

export interface AttendanceContext {
  forgotMap: Map<string, any>;
  forgotOccurrenceMap: Map<string, ForgotOccurrenceEntry>;
  lateForgivenSet: Set<string>;
  earlyForgivenSet: Set<string>;
  leavePeriodsMap: Map<string, Set<string>>;
}
export async function buildAttendanceContext({
  userId,
  rangeStart,
  rangeEnd,
  periodStart,
  periodEnd,
  excelRawByDate = new Map(),
  session
}: BuildAttendanceContextInput): Promise<AttendanceContext> {
  const [monthWorksheets, forgotReqs, lateReqs, earlyReqs, leaveStatuses, monthLeaveStatuses] =
    await Promise.all([
      WorkSheetModel.find({
        user_id: userId,
        date: { $gte: periodStart, $lte: periodEnd },
        isDeleted: false
      }).session(session ?? null),
      RequestModel.find({
        user_id: userId,
        request_type: "forgot_checkin",
        status: "approved",
        isDeleted: false,
        date: { $gte: periodStart, $lte: periodEnd }
      })
        .sort({ date: 1 })
        .session(session ?? null),
      RequestModel.find({
        user_id: userId,
        request_type: "late_early",
        type: "late",
        status: "approved",
        isDeleted: false,
        date: { $gte: rangeStart, $lte: rangeEnd }
      }).session(session ?? null),
      RequestModel.find({
        user_id: userId,
        request_type: "late_early",
        type: "early_out",
        status: "approved",
        isDeleted: false,
        date: { $gte: rangeStart, $lte: rangeEnd }
      }).session(session ?? null),
      WorkDayStatusModel.find({
        user_id: userId,
        date: { $gte: rangeStart, $lte: rangeEnd },
        status: { $in: LEAVE_STATUSES },
        isDeleted: false
      }).session(session ?? null),
      WorkDayStatusModel.find({
        user_id: userId,
        date: { $gte: periodStart, $lte: periodEnd },
        status: { $in: LEAVE_STATUSES },
        isDeleted: false
      }).session(session ?? null)
    ]);

  const forgotMap = new Map(
    (forgotReqs as any[]).map((r) => [moment.tz(r.date, TZ).format("YYYY-MM-DD"), r])
  );

  const monthLeavePeriodsMap = new Map<string, Set<string>>();
  for (const ds of monthLeaveStatuses as any[]) {
    const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
    if (!monthLeavePeriodsMap.has(key)) monthLeavePeriodsMap.set(key, new Set());
    monthLeavePeriodsMap.get(key)!.add(ds.period);
  }

  const monthWorksheetMap = new Map(
    (monthWorksheets as any[]).map((ws) => [moment.tz(ws.date, TZ).format("YYYY-MM-DD"), ws])
  );

  const daySnapshots: ForgotDaySnapshot[] = [];
  const allDateKeys = new Set([...monthWorksheetMap.keys(), ...excelRawByDate.keys()]);
  for (const dateKey of allDateKeys) {
    const ws = monthWorksheetMap.get(dateKey);
    const excelRow = excelRawByDate.get(dateKey);
    const periods = monthLeavePeriodsMap.get(dateKey);
    const leaveMorning = !!periods && (periods.has("morning") || periods.has("full"));
    const leaveAfternoon = !!periods && (periods.has("afternoon") || periods.has("full"));

    const { checkIn, checkOut } = normalizeDayPunches({
      machineIn: excelRow?.rawIn
        ? moment.tz(`${dateKey} ${excelRow.rawIn}`, "YYYY-MM-DD HH:mm", TZ).toDate()
        : null,
      machineOut: excelRow?.rawOut
        ? moment.tz(`${dateKey} ${excelRow.rawOut}`, "YYYY-MM-DD HH:mm", TZ).toDate()
        : null,
      appIn: ws?.check_in ? new Date(ws.check_in) : null,
      appOut: ws?.check_out ? new Date(ws.check_out) : null,
      forgot: forgotMap.get(dateKey),
      worksheet: ws,
      leaveMorning,
      leaveAfternoon
    });
    if (!checkIn && !checkOut) continue;

    daySnapshots.push({
      dateKey,
      hasIn: !!checkIn,
      hasOut: !!checkOut,
      leaveMorning,
      leaveAfternoon
    });
  }

  const forgotOccurrenceMap = buildUnifiedForgotOccurrenceMap({
    approvedForgotRequests: forgotReqs as unknown as { date: Date }[],
    daySnapshots
  });

  const lateForgivenSet = new Set(
    (lateReqs as any[]).map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD"))
  );
  const earlyForgivenSet = new Set(
    (earlyReqs as any[]).map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD"))
  );

  const leavePeriodsMap = new Map<string, Set<string>>();
  for (const ds of leaveStatuses as any[]) {
    const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
    if (!leavePeriodsMap.has(key)) leavePeriodsMap.set(key, new Set());
    leavePeriodsMap.get(key)!.add(ds.period);
  }

  return { forgotMap, forgotOccurrenceMap, lateForgivenSet, earlyForgivenSet, leavePeriodsMap };
}
