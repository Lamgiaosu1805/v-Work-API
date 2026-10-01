import mongoose from "mongoose";
import moment from "moment-timezone";
import dotenv from "dotenv";

dotenv.config();

const UserInfoModel = require("../src/models/UserInfoModel");
const { RequestModel } = require("../src/models/RequestModel");
const WorkSheetModel = require("../src/models/WorkSheetModel");
const WorkDayStatusModel = require("../src/models/WorkDayStatusModel");
const { buildWorkDatesWithStatus } = require("../src/helpers/requestUtils");
const {
  processAttendanceDay,
  buildLatePenaltyResolver,
  buildEarlyPenaltyResolver,
  buildForgotPenaltyResolver
} = require("../src/modules/timesheet");
const { buildAttendanceContext } = require("../src/workflows/import-attendance.workflow");
const { getPayrollPeriodRange } = require("../src/helpers/payrollPeriod");

const TZ = "Asia/Ho_Chi_Minh";
const LIVE_URI =
  "mongodb://admin:nghiemlamhust1@42.113.122.242:27017/v_work_live_db?authSource=admin&replicaSet=rs0";

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const fromStr = getArg("from");
  const toStr = getArg("to");
  const useLive = process.argv.includes("--live");
  const apply = process.argv.includes("--apply");

  if (!fromStr || !toStr) {
    console.error(
      "Thiếu tham số. Dùng: npx ts-node --transpile-only scripts/repairLeaveStatus.ts --from=YYYY-MM-DD --to=YYYY-MM-DD [--apply] [--live]"
    );
    process.exit(1);
  }

  const uri = useLive ? LIVE_URI : (process.env.MONGODB_URI as string);
  await mongoose.connect(uri);
  console.log(
    `Kết nối DB: ${mongoose.connection.name} (${useLive ? "LIVE" : "theo .env"}) — mode: ${
      apply ? "APPLY (sẽ ghi thật)" : "DRY RUN (chỉ in kế hoạch)"
    }`
  );

  const from = moment.tz(fromStr, "YYYY-MM-DD", TZ).startOf("day");
  const to = moment.tz(toStr, "YYYY-MM-DD", TZ).endOf("day");

  const requests = await RequestModel.find({
    request_type: "leave",
    status: "approved",
    isDeleted: false,
    from_date: { $lte: to.toDate() },
    to_date: { $gte: from.toDate() }
  }).lean();

  const userIds = [...new Set(requests.map((r: any) => String(r.user_id)))];
  const userInfos = await UserInfoModel.find({ _id: { $in: userIds } })
    .select("full_name")
    .lean();
  const nameById = new Map(userInfos.map((u: any) => [String(u._id), u.full_name]));

  console.log(`Tổng số đơn nghỉ phép đã duyệt trong khoảng: ${requests.length}\n`);

  // ===== BƯỚC A: khôi phục WorkDayStatus cho đúng (ngày, buổi) bị nghỉ phép =====
  let stepACount = 0;
  const touchedWorksheetKeys = new Set<string>(); // `${userId}|${dateKey}` -> cần chạy lại bước B

  for (const request of requests as any[]) {
    const fromMoment = moment.tz(request.from_date, TZ).startOf("day");
    const toMoment = moment.tz(request.to_date, TZ).startOf("day");
    const datesWithStatus = buildWorkDatesWithStatus(request, fromMoment, toMoment);

    for (const { date, period, status } of datesWithStatus as any[]) {
      // eslint-disable-next-line no-await-in-loop
      const worksheet = await WorkSheetModel.findOne({
        user_id: request.user_id,
        date,
        isDeleted: false
      }).select("_id");

      const dateKey = moment.tz(date, TZ).format("DD/MM/YYYY");
      const employee = nameById.get(String(request.user_id)) ?? String(request.user_id);

      if (!worksheet) {
        console.log(
          `  [BƯỚC A][BỎ QUA - không có worksheet] ${employee} ${dateKey} buổi ${period} -> ${status}`
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      console.log(
        `  [BƯỚC A] ${employee} ${dateKey} buổi ${period}: set status="${status}" (worksheet ${worksheet._id})`
      );
      stepACount++;
      touchedWorksheetKeys.add(`${request.user_id}|${worksheet._id}|${dateKey}`);

      if (apply) {
        // Chỉ xoá bản ghi THỰC SỰ xung đột với buổi đang ghi — "full" xung đột với mọi buổi, còn
        // "morning"/"afternoon" chỉ xung đột với chính buổi đó (và "full"), KHÔNG được xoá buổi còn
        // lại nếu nó đã được ghi đúng từ 1 đơn khác trong cùng ngày (vd sáng nghỉ có lương, chiều nghỉ
        // không lương — 2 đơn riêng biệt cùng ngày).
        const overlappingPeriods =
          period === "full" ? ["full", "morning", "afternoon"] : ["full", period];
        // eslint-disable-next-line no-await-in-loop
        await WorkDayStatusModel.deleteMany({
          user_id: request.user_id,
          date,
          period: { $in: overlappingPeriods },
          isDeleted: false
        });
        // eslint-disable-next-line no-await-in-loop
        await WorkDayStatusModel.create({
          user_id: request.user_id,
          worksheet_id: worksheet._id,
          date,
          period,
          status,
          sources: [{ ref_id: request._id, ref_type: "request" }]
        });
      }
    }
  }

  console.log(`\nTổng số (ngày x buổi) BƯỚC A xử lý: ${stepACount}\n`);

  // ===== BƯỚC B: chạy lại processAttendanceDay cho các worksheet liên quan =====
  const resolveLatePenalty = await buildLatePenaltyResolver();
  const resolveEarlyPenalty = await buildEarlyPenaltyResolver();
  const resolveForgotPenalty = await buildForgotPenaltyResolver();

  const byWorksheet = new Map<string, { userId: string; worksheetId: string; dateKey: string }>();
  for (const key of touchedWorksheetKeys) {
    const [userId, worksheetId, dateDisplay] = key.split("|");
    const dateKey = moment.tz(dateDisplay, "DD/MM/YYYY", TZ).format("YYYY-MM-DD");
    byWorksheet.set(`${userId}|${dateKey}`, { userId, worksheetId, dateKey });
  }

  console.log(`Tổng số worksheet cần chạy lại BƯỚC B: ${byWorksheet.size}\n`);

  let stepBCount = 0;
  for (const { userId, worksheetId, dateKey } of byWorksheet.values()) {
    // eslint-disable-next-line no-await-in-loop
    const worksheet = await WorkSheetModel.findById(worksheetId).populate("shifts");
    if (!worksheet || (!worksheet.check_in && !worksheet.check_out)) {
      // eslint-disable-next-line no-continue
      continue; // không có chấm công thật -> không cần tính lại buổi còn lại
    }

    const dayStart = moment.tz(dateKey, TZ).startOf("day").toDate();
    const dayEnd = moment.tz(dateKey, TZ).endOf("day").toDate();
    const { start: periodStart, end: periodEnd } = getPayrollPeriodRange(dayStart);

    // eslint-disable-next-line no-await-in-loop
    const context = await buildAttendanceContext({
      userId,
      rangeStart: dayStart,
      rangeEnd: dayEnd,
      periodStart,
      periodEnd
    });

    const rawIn = worksheet.check_in ? moment.tz(worksheet.check_in, TZ).format("HH:mm") : null;
    const rawOut = worksheet.check_out ? moment.tz(worksheet.check_out, TZ).format("HH:mm") : null;

    const employee = nameById.get(userId) ?? userId;
    console.log(`  [BƯỚC B] ${employee} ${moment.tz(dateKey, TZ).format("DD/MM/YYYY")}`);

    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await processAttendanceDay({
        userId,
        worksheetId,
        dateKey,
        rawIn,
        rawOut,
        worksheet,
        forgotMap: context.forgotMap,
        forgotOccurrenceMap: context.forgotOccurrenceMap,
        lateForgivenSet: context.lateForgivenSet,
        earlyForgivenSet: context.earlyForgivenSet,
        leavePeriodsMap: context.leavePeriodsMap,
        resolveLatePenalty,
        resolveEarlyPenalty,
        resolveForgotPenalty
      });
    }
    stepBCount++;
  }

  console.log(`\nTổng số worksheet BƯỚC B đã xử lý: ${stepBCount}`);
  console.log(
    apply ? "\n✅ Đã ghi thật vào DB." : "\n(DRY RUN — chưa ghi gì, thêm --apply để ghi thật)"
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
