import moment from "moment-timezone";
import { ClientSession } from "mongoose";
import WorkSheetModel from "../../models/WorkSheetModel";
import WorkDayStatusModel from "../../models/WorkDayStatusModel";
import UserInfoModel from "../../models/UserInfoModel";
import WorkScheduleModel from "../../models/WorkScheduleModel";
import ShiftModel from "../../models/ShiftModel";
import { buildWorkDatesWithStatus } from "../../helpers/requestUtils";
import { adjustLeaveBalance, LeaveLockTimeoutError } from "../../modules/leave";
import { applyLeaveConflictOverride } from "../../modules/timesheet";
import { ArgumentInvalidException } from "../../core/exceptions/exceptions";
import { LEAVE_BALANCE_REASON } from "../../constants";

const TZ = "Asia/Ho_Chi_Minh";

// Port nguyên helpers/leaveHandler.js's onCreate/onApprove/onReject (task 1.8.6) — chuyển vào
// workflows/ vì gọi thẳng modules/leave + modules/timesheet + ghi trực tiếp WorkSheetModel/
// WorkDayStatusModel (Timesheet-owned). validate/validateAsync (business rule thuần Request — hạn
// retroactive, kiểm tra ngày lễ, tính paid_days/unpaid_days) GIỮ NGUYÊN ở helpers/leaveHandler.js.

export async function onCreate(request: any, userInfo: any, session: ClientSession): Promise<any> {
  if (request.paid_days > 0) {
    try {
      await adjustLeaveBalance({
        userId: userInfo._id,
        amount: -request.paid_days,
        reason: LEAVE_BALANCE_REASON.LEAVE_REQUEST_DEDUCTION,
        refId: request._id,
        refType: "request",
        createdBy: userInfo.id_account,
        allowNegative: true,
        session
      });
    } catch (e) {
      const isKnownLeaveError =
        e instanceof ArgumentInvalidException || e instanceof LeaveLockTimeoutError;
      return {
        status: isKnownLeaveError ? (e as any).statusCode : 500,
        message: (e as Error).message
      };
    }
  }
  return null;
}

async function resolveShiftsForDates(
  userId: string,
  dates: { date: Date }[],
  session: ClientSession
): Promise<Map<string, any[]>> {
  const userInfo = await UserInfoModel.findById(userId, {
    employment_type: 1
  }).session(session);
  const isParttime = userInfo?.employment_type === "parttime";

  const dated = dates.map(({ date }) => {
    const m = moment.tz(date, TZ);
    return { key: m.format("YYYY-MM-DD"), dayOfWeek: m.day() === 0 ? 7 : m.day() };
  });

  const map = new Map<string, any[]>();

  if (isParttime) {
    const schedules = await WorkScheduleModel.find({ userId }).session(session);
    const byDow = new Map<number, any[]>();
    for (const s of schedules as any[]) {
      const arr = byDow.get(s.dayOfWeek) || [];
      arr.push(...s.shifts);
      byDow.set(s.dayOfWeek, arr);
    }
    for (const { key, dayOfWeek } of dated) {
      map.set(key, byDow.get(dayOfWeek) || []);
    }
  } else {
    const [adminShift, morningShift] = await Promise.all([
      ShiftModel.findOne({ name: "Ca hành chính" }).session(session),
      ShiftModel.findOne({ name: "Ca sáng" }).session(session)
    ]);
    for (const { key, dayOfWeek } of dated) {
      const shift: any = dayOfWeek === 6 ? morningShift : adminShift;
      map.set(key, shift ? [shift._id] : []);
    }
  }

  return map;
}

export async function onApprove(request: any, session: ClientSession): Promise<void> {
  const fromMoment = moment.tz(request.from_date, TZ).startOf("day");
  const toMoment = moment.tz(request.to_date, TZ).startOf("day");
  const fromStart = fromMoment.toDate();
  const toEnd = moment.tz(request.to_date, TZ).endOf("day").toDate();

  const datesWithStatus = buildWorkDatesWithStatus(request, fromMoment, toMoment);

  const existing = await WorkSheetModel.find(
    { user_id: request.user_id, date: { $gte: fromStart, $lte: toEnd }, isDeleted: false },
    { date: 1, check_in: 1, check_out: 1, shifts: 1 }
  )
    .populate("shifts")
    .session(session);
  const sheetMap = new Map(
    (existing as any[]).map((w) => [moment.tz(w.date, TZ).format("YYYY-MM-DD"), w._id])
  );

  const missing = datesWithStatus.filter(
    (d: any) => !sheetMap.has(moment.tz(d.date, TZ).format("YYYY-MM-DD"))
  );
  if (missing.length) {
    const shiftMap = await resolveShiftsForDates(request.user_id, missing, session);
    const created = await WorkSheetModel.insertMany(
      missing.map(({ date }: any) => ({
        user_id: request.user_id,
        date,
        shifts: shiftMap.get(moment.tz(date, TZ).format("YYYY-MM-DD")) || []
      })),
      { session }
    );
    (created as any[]).forEach((w) =>
      sheetMap.set(moment.tz(w.date, TZ).format("YYYY-MM-DD"), w._id)
    );
  }

  const AWAY_STATUSES = ["business_trip", "client_visit", "remote"];

  for (const { date, status, period, weight } of datesWithStatus as any[]) {
    const worksheet_id = sheetMap.get(moment.tz(date, TZ).format("YYYY-MM-DD"));

    // eslint-disable-next-line no-await-in-loop
    const priorStatuses = await WorkDayStatusModel.find(
      { user_id: request.user_id, date, isDeleted: false },
      { status: 1 }
    ).session(session);
    const wasAwayDay = (priorStatuses as any[]).some((s) => AWAY_STATUSES.includes(s.status));
    const existingWs: any = (existing as any[]).find(
      (w) => moment.tz(w.date, TZ).format("YYYY-MM-DD") === moment.tz(date, TZ).format("YYYY-MM-DD")
    );
    const hasGenuineAttendance = !wasAwayDay && existingWs?.check_in && existingWs?.check_out;

    // eslint-disable-next-line no-await-in-loop
    await WorkDayStatusModel.deleteMany(
      { user_id: request.user_id, date, isDeleted: false },
      { session }
    );
    // eslint-disable-next-line no-await-in-loop
    await WorkDayStatusModel.create(
      [
        {
          user_id: request.user_id,
          worksheet_id,
          date,
          period,
          status,
          sources: [{ ref_id: request._id, ref_type: "request" }]
        }
      ],
      { session }
    );

    if (!hasGenuineAttendance) {
      const wsUpdate: Record<string, unknown> = {
        work_unit: status === "leave_paid" ? weight : 0,
        minutes_late: 0,
        minute_early: 0,
        penalty_amount: 0
      };
      if (wasAwayDay) {
        wsUpdate.check_in = null;
        wsUpdate.check_out = null;
      }
      // eslint-disable-next-line no-await-in-loop
      await WorkSheetModel.updateOne({ _id: worksheet_id }, wsUpdate, { session });
    }
  }

  const refreshed = await WorkSheetModel.find(
    { user_id: request.user_id, date: { $gte: fromStart, $lte: toEnd }, isDeleted: false },
    { date: 1, check_in: 1, check_out: 1, shifts: 1 }
  )
    .populate("shifts")
    .session(session);

  for (const w of refreshed as any[]) {
    if (!w.check_in || !w.check_out) continue;
    const lastShift = w.shifts?.length ? w.shifts[w.shifts.length - 1] : null;
    // eslint-disable-next-line no-await-in-loop
    const { leaveRefundAmount } = await applyLeaveConflictOverride({
      userId: request.user_id.toString(),
      worksheetId: w._id.toString(),
      dateKey: moment.tz(w.date, TZ).format("YYYY-MM-DD"),
      checkInTime: w.check_in,
      checkOutTime: w.check_out,
      lastShiftEnd: lastShift?.end_time ?? null,
      session
    });
    if (leaveRefundAmount > 0) {
      // eslint-disable-next-line no-await-in-loop
      await adjustLeaveBalance({
        userId: request.user_id,
        amount: leaveRefundAmount,
        reason: LEAVE_BALANCE_REASON.ATTENDANCE_OVERRIDE_REFUND,
        refId: w._id,
        refType: "system",
        allowNegative: true,
        session
      });
    }
  }
}

export async function onReject(
  request: any,
  session: ClientSession,
  isCancel = false
): Promise<void> {
  if (request.paid_days > 0) {
    await adjustLeaveBalance({
      userId: request.user_id,
      amount: request.paid_days,
      reason: isCancel ? LEAVE_BALANCE_REASON.CANCEL_REFUND : LEAVE_BALANCE_REASON.REJECT_REFUND,
      refId: request._id,
      refType: "request",
      allowNegative: true,
      session
    });
  }
}
