import moment from "moment-timezone";
import { ClientSession } from "mongoose";
import WorkDayStatusModel from "../../models/WorkDayStatusModel";
import { getPayrollPeriodRange } from "../../helpers/payrollPeriod";
import {
  processAttendanceDay,
  getWorksheetForDay,
  recordRawPunch,
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver
} from "../../modules/timesheet";
import { buildAttendanceContext } from "../import-attendance.workflow";

const TZ = "Asia/Ho_Chi_Minh";

// Port nguyên helpers/forgotCheckinHandler.js's onCreate/onReject/onApprove (task 1.8.6) — chuyển vào
// workflows/ vì gọi thẳng modules/timesheet + buildAttendanceContext (workflows/import-attendance.workflow).
// computeForgotOccurrence (dùng trong validateAsync) KHÔNG chuyển — validateAsync là business rule
// thuần của Request (tính occurrence để quyết định ngưỡng đa duyệt), giữ nguyên ở
// helpers/forgotCheckinHandler.js.

export async function onCreate(
  request: any,
  _userInfo: any,
  session: ClientSession
): Promise<null> {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();
  await WorkDayStatusModel.updateMany(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false
    },
    { $addToSet: { sources: { ref_id: request._id, ref_type: "request" } } },
    { session }
  );
  return null;
}

export async function onReject(request: any, session: ClientSession): Promise<void> {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();
  await WorkDayStatusModel.updateMany(
    {
      user_id: request.user_id,
      date: { $gte: dateStart, $lte: dateEnd },
      isDeleted: false
    },
    { $pull: { sources: { ref_id: request._id, ref_type: "request" } } },
    { session }
  );
}

export async function onApprove(request: any, session: ClientSession): Promise<void> {
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();

  const existing = await getWorksheetForDay(request.user_id.toString(), dateStart, session);

  const clockUpdate: { check_in?: Date; check_out?: Date } = {};
  if (request.expected_check_in) {
    if (
      request.type === "check_in" &&
      existing?.check_in &&
      !existing?.check_out &&
      new Date(existing.check_in) > new Date(request.expected_check_in)
    ) {
      clockUpdate.check_out = existing.check_in as Date;
    }
    clockUpdate.check_in = new Date(request.expected_check_in);
  }
  if (request.expected_check_out) {
    if (
      request.type === "check_out" &&
      existing?.check_out &&
      !existing?.check_in &&
      new Date(existing.check_out) < new Date(request.expected_check_out)
    ) {
      clockUpdate.check_in = existing.check_out as Date;
    }
    clockUpdate.check_out = new Date(request.expected_check_out);
  }

  const worksheet = await recordRawPunch({
    userId: request.user_id.toString(),
    date: dateStart,
    checkIn: clockUpdate.check_in,
    checkOut: clockUpdate.check_out,
    session
  });

  const dateKey = moment.tz(request.date, TZ).format("YYYY-MM-DD");
  const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(request.date);
  const [context, resolveLatePenalty, resolveEarlyPenalty, resolveForgotPenalty] =
    await Promise.all([
      buildAttendanceContext({
        userId: request.user_id.toString(),
        rangeStart: dateStart,
        rangeEnd: dateEnd,
        periodStart,
        periodEnd,
        session
      }),
      buildLatePenaltyResolver(),
      buildEarlyPenaltyResolver(),
      buildForgotPenaltyResolver()
    ]);

  await processAttendanceDay({
    userId: request.user_id.toString(),
    worksheetId: worksheet.id,
    dateKey,
    rawIn: worksheet.check_in ? moment.tz(worksheet.check_in, TZ).format("HH:mm") : null,
    rawOut: worksheet.check_out ? moment.tz(worksheet.check_out, TZ).format("HH:mm") : null,
    worksheet,
    ...context,
    resolveLatePenalty,
    resolveEarlyPenalty,
    resolveForgotPenalty,
    session
  });
}
