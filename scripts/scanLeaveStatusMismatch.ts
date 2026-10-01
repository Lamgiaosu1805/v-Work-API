import mongoose from "mongoose";
import moment from "moment-timezone";
import dotenv from "dotenv";

dotenv.config();

const UserInfoModel = require("../src/models/UserInfoModel");
const { RequestModel } = require("../src/models/RequestModel");
const WorkDayStatusModel = require("../src/models/WorkDayStatusModel");
const { buildWorkDatesWithStatus } = require("../src/helpers/requestUtils");

const TZ = "Asia/Ho_Chi_Minh";
const LIVE_URI =
  "mongodb://admin:nghiemlamhust1@42.113.122.242:27017/v_work_live_db?authSource=admin&replicaSet=rs0";

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function getActualStatus(
  docsForDate: { period: string; status: string }[],
  period: "morning" | "afternoon" | "full"
): string | null {
  const full = docsForDate.find((d) => d.period === "full");
  if (full) return full.status;
  const specific = docsForDate.find((d) => d.period === period);
  return specific ? specific.status : null;
}

async function main() {
  const fromStr = getArg("from");
  const toStr = getArg("to");
  const useLive = process.argv.includes("--live");

  if (!fromStr || !toStr) {
    console.error(
      "Thiếu tham số. Dùng: npx ts-node --transpile-only scripts/scanLeaveStatusMismatch.ts --from=YYYY-MM-DD --to=YYYY-MM-DD [--live]"
    );
    process.exit(1);
  }

  const uri = useLive ? LIVE_URI : (process.env.MONGODB_URI as string);
  await mongoose.connect(uri);
  console.log(`Kết nối DB: ${mongoose.connection.name} (${useLive ? "LIVE" : "theo .env"})`);

  const from = moment.tz(fromStr, "YYYY-MM-DD", TZ).startOf("day");
  const to = moment.tz(toStr, "YYYY-MM-DD", TZ).endOf("day");

  const requests = await RequestModel.find({
    request_type: "leave",
    status: "approved",
    isDeleted: false,
    from_date: { $lte: to.toDate() },
    to_date: { $gte: from.toDate() }
  }).lean();

  console.log(`Tổng số đơn nghỉ phép đã duyệt trong khoảng: ${requests.length}\n`);

  const userIds = [...new Set(requests.map((r: any) => String(r.user_id)))];
  const userInfos = await UserInfoModel.find({ _id: { $in: userIds } })
    .select("full_name")
    .lean();
  const nameById = new Map(userInfos.map((u: any) => [String(u._id), u.full_name]));

  const mismatches: any[] = [];
  let totalChecked = 0;
  let requestIndex = 0;

  for (const request of requests as any[]) {
    requestIndex++;
    if (requestIndex % 10 === 0 || requestIndex === requests.length) {
      console.log(`... đang xử lý đơn ${requestIndex}/${requests.length}`);
    }
    const fromMoment = moment.tz(request.from_date, TZ).startOf("day");
    const toMoment = moment.tz(request.to_date, TZ).startOf("day");
    const datesWithStatus = buildWorkDatesWithStatus(request, fromMoment, toMoment);

    const dayStart = fromMoment.toDate();
    const dayEnd = moment.tz(request.to_date, TZ).endOf("day").toDate();
    // eslint-disable-next-line no-await-in-loop
    const docs = await WorkDayStatusModel.find({
      user_id: request.user_id,
      date: { $gte: dayStart, $lte: dayEnd },
      isDeleted: false
    })
      .select("date period status sources")
      .lean();

    for (const { date, period, status: expectedStatus } of datesWithStatus as any[]) {
      totalChecked++;
      const dateKey = moment.tz(date, TZ).format("YYYY-MM-DD");
      const docsForDate = (docs as any[]).filter(
        (d) => moment.tz(d.date, TZ).format("YYYY-MM-DD") === dateKey
      );
      const actualStatus = getActualStatus(docsForDate, period);

      if (actualStatus !== expectedStatus) {
        const matchingDoc = docsForDate.find((d) => d.period === "full" || d.period === period);
        mismatches.push({
          employee: nameById.get(String(request.user_id)) ?? String(request.user_id),
          user_id: String(request.user_id),
          date: moment.tz(date, TZ).format("DD/MM/YYYY"),
          period,
          expectedStatus,
          actualStatus: actualStatus ?? "(không có bản ghi)",
          sources: matchingDoc?.sources ?? null,
          request_id: String(request._id),
          request_reason: request.reason
        });
      }
    }
  }

  console.log(`Tổng số (ngày x buổi) đã kiểm tra: ${totalChecked}`);
  console.log(`Số chỗ bị lệch: ${mismatches.length}\n`);

  if (mismatches.length) {
    console.log(JSON.stringify(mismatches, null, 2));

    const byEmployee = new Map<string, number>();
    for (const m of mismatches) {
      byEmployee.set(m.employee, (byEmployee.get(m.employee) ?? 0) + 1);
    }
    console.log("\nTổng hợp theo nhân viên:");
    for (const [name, count] of byEmployee) {
      console.log(`  - ${name}: ${count} chỗ lệch`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
