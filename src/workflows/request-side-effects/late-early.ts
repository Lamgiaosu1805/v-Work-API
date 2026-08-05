import moment from "moment-timezone";
import { ClientSession } from "mongoose";
import { getPayrollPeriodRange } from "../../helpers/payrollPeriod";
import {
  processAttendanceDay,
  getWorksheetForDay,
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver
} from "../../modules/timesheet";
import { buildAttendanceContext } from "../import-attendance.workflow";

const TZ = "Asia/Ho_Chi_Minh";

// Port nguyên helpers/lateEarlyHandler.js's onApprove (task 1.8.6) — chuyển vào workflows/ vì gọi thẳng
// modules/timesheet + buildAttendanceContext (workflows/import-attendance.workflow, task 1.8.5.5).
export async function onApprove(request: any, session: ClientSession): Promise<void> {
  const dateKey = moment.tz(request.date, TZ).format("YYYY-MM-DD");
  const dateStart = moment.tz(request.date, TZ).startOf("day").toDate();
  const dateEnd = moment.tz(request.date, TZ).endOf("day").toDate();

  const worksheet = await getWorksheetForDay(request.user_id.toString(), dateStart, session);
  if (!worksheet || (!worksheet.check_in && !worksheet.check_out)) return;

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
