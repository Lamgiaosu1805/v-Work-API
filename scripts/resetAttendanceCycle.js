/**
 * Script reset bảng công (WorkSheet + WorkDayStatus) về trạng thái "pending"
 * và soft-delete (isDeleted=true) tất cả đơn từ (Request: leave/late_early/remote/
 * business_trip/client_visit/explanation/forgot_checkin) trong một khoảng thời gian
 * (thường dùng khi cần làm lại chấm công/đơn từ cho 1 kỳ tính lương do sai dữ liệu nguồn).
 *
 * KHÔNG đụng vào AttendancePenaltyModel — nếu cần reset cả phạt, báo lại để bổ sung.
 *
 * Chạy:
 *   node scripts/resetAttendanceCycle.js --from=2026-07-01 --to=2026-07-31
 * Dry run (chỉ đếm, không ghi DB):
 *   node scripts/resetAttendanceCycle.js --from=2026-07-01 --to=2026-07-31 --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const WorkSheet = require("../src/models/WorkSheetModel");
const WorkDayStatus = require("../src/models/WorkDayStatusModel");
const { RequestModel } = require("../src/models/RequestModel");

const TZ = "Asia/Ho_Chi_Minh";
const isDryRun = process.argv.includes("--dry-run");

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function run() {
  const fromStr = getArg("from");
  const toStr = getArg("to");

  if (!fromStr || !toStr) {
    console.error(
      "Thiếu tham số. Dùng: node scripts/resetAttendanceCycle.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--dry-run]"
    );
    process.exit(1);
  }

  const from = moment.tz(fromStr, "YYYY-MM-DD", TZ).startOf("day");
  const to = moment.tz(toStr, "YYYY-MM-DD", TZ).endOf("day");

  if (!from.isValid() || !to.isValid() || !from.isBefore(to)) {
    console.error("Ngày không hợp lệ, hoặc --from phải nhỏ hơn --to");
    process.exit(1);
  }

  const fromDate = from.toDate();
  const toDate = to.toDate();

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`DB connected${isDryRun ? " [DRY RUN - không ghi DB]" : ""}`);
  console.log(`Phạm vi reset: ${from.format("DD/MM/YYYY")} → ${to.format("DD/MM/YYYY")}`);

  const dateRange = { $gte: fromDate, $lte: toDate };
  const requestFilter = {
    isDeleted: false,
    $or: [{ date: dateRange }, { from_date: { $lte: toDate }, to_date: { $gte: fromDate } }]
  };

  const [worksheetCount, workDayStatusCount, requestCount] = await Promise.all([
    WorkSheet.countDocuments({ date: dateRange, isDeleted: false }),
    WorkDayStatus.countDocuments({ date: dateRange, isDeleted: false }),
    RequestModel.countDocuments(requestFilter)
  ]);

  console.log(`- WorkSheet sẽ reset về pending: ${worksheetCount}`);
  console.log(`- WorkDayStatus sẽ reset về pending: ${workDayStatusCount}`);
  console.log(`- Request sẽ xóa mềm (isDeleted=true): ${requestCount}`);

  if (isDryRun) {
    console.log("\nDry run xong — chưa ghi DB.");
    await mongoose.disconnect();
    return;
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await WorkSheet.updateMany(
      { date: dateRange, isDeleted: false },
      {
        $set: {
          check_in: null,
          check_out: null,
          minutes_late: 0,
          minute_early: 0,
          work_unit: null,
          penalty_amount: 0,
          edited_by: null,
          edited_at: null
        }
      },
      { session }
    );

    await WorkDayStatus.updateMany(
      { date: dateRange, isDeleted: false },
      [
        {
          $set: {
            status: "pending",
            sources: [{ ref_id: "$worksheet_id", ref_type: "system" }]
          }
        }
      ],
      { session }
    );

    await RequestModel.updateMany(requestFilter, { $set: { isDeleted: true } }, { session });

    await session.commitTransaction();
    console.log("\n✅ Đã reset bảng công về pending và xóa mềm đơn từ trong kỳ.");
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ Lỗi, đã rollback:", err.message);
    throw err;
  } finally {
    session.endSession();
  }

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Lỗi:", err);
    process.exit(1);
  });
