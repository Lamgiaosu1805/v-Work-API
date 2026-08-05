const cron = require("node-cron");
const moment = require("moment-timezone");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const {
  processAttendanceDay,
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver
} = require("../modules/timesheet");
const { buildAttendanceContext } = require("../workflows/import-attendance.workflow");
const { getPayrollPeriodRange } = require("../helpers/payrollPeriod");

const TZ = "Asia/Ho_Chi_Minh";

// Port nguyên buildUserDayContext gốc — giữ lại tên + shape tham số cũ (positional) để 2 consumer khác
// (helpers/forgotCheckinHandler.js, helpers/lateEarlyHandler.js) không phải đổi call site, chỉ là
// wrapper mỏng gọi buildAttendanceContext (task 1.8.5.5, gộp về workflows/ — xem chi tiết trong plan
// doc). Tham số `todayStart`/`todayEnd` đổi tên ý nghĩa thành `rangeStart`/`rangeEnd` bên trong
// buildAttendanceContext (tổng quát hoá cho cả trường hợp nhiều ngày của importExcel), nhưng ở đây vẫn
// luôn truyền đúng 1 ngày như hành vi gốc.
async function buildUserDayContext(
  userId,
  dateKey,
  todayStart,
  todayEnd,
  periodStart,
  periodEnd,
  session = null
) {
  return buildAttendanceContext({
    userId: userId.toString(),
    rangeStart: todayStart,
    rangeEnd: todayEnd,
    periodStart,
    periodEnd,
    session: session ?? undefined
  });
}

async function finalizeWorkDay(targetDate = null) {
  try {
    const now = targetDate ? moment.tz(targetDate, TZ) : moment.tz(TZ);
    const todayStart = now.clone().startOf("day");
    const todayEnd = now.clone().endOf("day");
    const dateKey = todayStart.format("YYYY-MM-DD");
    const today = todayStart.toDate();
    const tomorrow = todayStart.clone().add(1, "day").toDate();
    const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(today);

    console.log(`[Cron] finalizeWorkDay: ${todayStart.format("DD/MM/YYYY")}`);

    const resolveLatePenalty = await buildLatePenaltyResolver();
    const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
    const resolveForgotPenalty = await buildForgotPenaltyResolver();

    const worksheets = await WorkSheetModel.find({
      date: { $gte: today, $lt: tomorrow },
      isDeleted: false,
      $or: [{ check_in: { $ne: null } }, { check_out: { $ne: null } }]
    }).populate("shifts");

    let finalized = 0;
    let failed = 0;

    for (const worksheet of worksheets) {
      try {
        const {
          forgotMap,
          forgotOccurrenceMap,
          lateForgivenSet,
          earlyForgivenSet,
          leavePeriodsMap
        } = await buildUserDayContext(
          worksheet.user_id,
          dateKey,
          todayStart.toDate(),
          todayEnd.toDate(),
          periodStart,
          periodEnd
        );

        const rawIn = worksheet.check_in ? moment.tz(worksheet.check_in, TZ).format("HH:mm") : null;
        const rawOut = worksheet.check_out
          ? moment.tz(worksheet.check_out, TZ).format("HH:mm")
          : null;

        const result = await processAttendanceDay({
          userId: worksheet.user_id.toString(),
          worksheetId: worksheet._id.toString(),
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
        });
        if (result.skip) continue;

        if (!result.unchanged) finalized++;
      } catch (e) {
        console.error(`[Cron] finalizeWorkDay lỗi user ${worksheet.user_id}:`, e);
        failed++;
      }
    }

    // Dọn các trường hợp hoàn toàn không có dữ liệu chấm công (chưa từng check-in/check-out)
    await WorkDayStatusModel.updateMany(
      { date: { $gte: today, $lt: tomorrow }, status: "pending", isDeleted: false },
      { status: "absent" }
    );

    console.log(`[Cron] finalizeWorkDay hoàn tất: ${finalized} ngày cập nhật, ${failed} lỗi.`);
  } catch (error) {
    console.error("[Cron] Lỗi finalizeWorkDay:", error);
  }
}

function registerFinalizeWorkDayJob() {
  cron.schedule(
    "0 23 * * *",
    async () => {
      console.log("[Cron] Bắt đầu chạy finalizeWorkDay");
      await finalizeWorkDay();
    },
    { timezone: TZ }
  );
}

module.exports = { finalizeWorkDay, buildUserDayContext, registerFinalizeWorkDayJob };
