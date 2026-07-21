const cron = require("node-cron");
const moment = require("moment-timezone");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");
const { RequestModel } = require("../models/RequestModel");
const {
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver,
  buildUnifiedForgotOccurrenceMap
} = require("../helpers/attendancePenalty");
const { resolveAttendanceDay, saveAttendanceDay } = require("../helpers/attendanceHelper");

const TZ = "Asia/Ho_Chi_Minh";

// Build context (forgotMap, forgotOccurrenceMap, lateForgivenSet, earlyForgivenSet, leavePeriodsMap)
// cho 1 nhân viên trong ngày hôm nay, cùng cách importExcel đang load, để resolveAttendanceDay/
// saveAttendanceDay tính đúng status/work_unit y hệt luồng import.
async function buildUserDayContext(userId, dateKey, todayStart, todayEnd, monthStart, monthEnd) {
  const [monthWorksheets, forgotReqs, lateReqs, earlyReqs, leaveStatuses] = await Promise.all([
    WorkSheetModel.find({
      user_id: userId,
      date: { $gte: monthStart, $lte: monthEnd },
      isDeleted: false
    }),
    RequestModel.find({
      user_id: userId,
      request_type: "forgot_checkin",
      status: "approved",
      isDeleted: false,
      date: { $gte: monthStart, $lte: monthEnd }
    }).sort({ date: 1 }),
    RequestModel.find({
      user_id: userId,
      request_type: "late_early",
      type: "late",
      status: "approved",
      isDeleted: false,
      date: { $gte: todayStart, $lte: todayEnd }
    }),
    RequestModel.find({
      user_id: userId,
      request_type: "late_early",
      type: "early_out",
      status: "approved",
      isDeleted: false,
      date: { $gte: todayStart, $lte: todayEnd }
    }),
    WorkDayStatusModel.find({
      user_id: userId,
      date: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ["leave_paid", "leave_unpaid", "remote"] },
      isDeleted: false
    })
  ]);

  const forgotMap = new Map(forgotReqs.map((r) => [moment.tz(r.date, TZ).format("YYYY-MM-DD"), r]));

  const monthLeavePeriodsMap = new Map();
  for (const ds of leaveStatuses) {
    const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
    if (!monthLeavePeriodsMap.has(key)) monthLeavePeriodsMap.set(key, new Set());
    monthLeavePeriodsMap.get(key).add(ds.period);
  }

  const daySnapshots = [];
  for (const ws of monthWorksheets) {
    const wsDateKey = moment.tz(ws.date, TZ).format("YYYY-MM-DD");
    const hasIn = !!ws.check_in;
    const hasOut = !!ws.check_out;
    if (!hasIn && !hasOut) continue;
    const periods = monthLeavePeriodsMap.get(wsDateKey);
    daySnapshots.push({
      dateKey: wsDateKey,
      hasIn,
      hasOut,
      leaveMorning: !!periods && (periods.has("morning") || periods.has("full")),
      leaveAfternoon: !!periods && (periods.has("afternoon") || periods.has("full"))
    });
  }

  const forgotOccurrenceMap = buildUnifiedForgotOccurrenceMap({
    approvedForgotRequests: forgotReqs,
    daySnapshots
  });

  const lateForgivenSet = new Set(lateReqs.map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD")));
  const earlyForgivenSet = new Set(
    earlyReqs.map((r) => moment.tz(r.date, TZ).format("YYYY-MM-DD"))
  );

  const leavePeriodsMap = new Map();
  for (const ds of leaveStatuses) {
    const key = moment.tz(ds.date, TZ).format("YYYY-MM-DD");
    if (!leavePeriodsMap.has(key)) leavePeriodsMap.set(key, new Set());
    leavePeriodsMap.get(key).add(ds.period);
  }

  return { forgotMap, forgotOccurrenceMap, lateForgivenSet, earlyForgivenSet, leavePeriodsMap };
}

async function finalizeWorkDay() {
  try {
    const now = moment.tz(TZ);
    const todayStart = now.clone().startOf("day");
    const todayEnd = now.clone().endOf("day");
    const dateKey = todayStart.format("YYYY-MM-DD");
    const today = todayStart.toDate();
    const tomorrow = todayStart.clone().add(1, "day").toDate();
    const monthStart = todayStart.clone().startOf("month");
    const monthEnd = todayStart.clone().endOf("month");

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
          monthStart.toDate(),
          monthEnd.toDate()
        );

        const rawIn = worksheet.check_in ? moment.tz(worksheet.check_in, TZ).format("HH:mm") : null;
        const rawOut = worksheet.check_out
          ? moment.tz(worksheet.check_out, TZ).format("HH:mm")
          : null;

        const computed = resolveAttendanceDay({
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
        if (computed.skip) continue;

        await saveAttendanceDay({ userId: worksheet.user_id, dateKey, worksheet, computed });
        finalized++;
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

module.exports = { finalizeWorkDay, registerFinalizeWorkDayJob };
