/**
 * Script kiểm tra và bổ sung các bản ghi WorkSheet (+ WorkDayStatus "pending" đi kèm)
 * bị thiếu trong một khoảng ngày — dùng khi cron createDailyWorkSheets lỗi/không chạy
 * cho một số nhân viên.
 *
 * Chạy lại cùng logic với cron gốc (src/jobs/genWorkSheet.js::createDailyWorkSheets),
 * upsert bằng $setOnInsert nên an toàn khi chạy nhiều lần — chỉ thêm bản ghi còn thiếu,
 * không sửa/ghi đè bản ghi đã tồn tại. Tự bỏ qua Chủ Nhật và ngày lễ như cron gốc.
 *
 * Chạy:
 *   node scripts/backfillMissingWorkSheets.js --from=2026-07-01 --to=2026-07-31
 */
require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { createDailyWorkSheets } = require("../src/jobs/genWorkSheet");
const WorkSheet = require("../src/models/WorkSheetModel");
const UserInfo = require("../src/models/UserInfoModel");

const TZ = "Asia/Ho_Chi_Minh";

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
      "Thiếu tham số. Dùng: node scripts/backfillMissingWorkSheets.js --from=YYYY-MM-DD --to=YYYY-MM-DD"
    );
    process.exit(1);
  }

  const from = moment.tz(fromStr, "YYYY-MM-DD", TZ).startOf("day");
  const to = moment.tz(toStr, "YYYY-MM-DD", TZ).startOf("day");

  if (!from.isValid() || !to.isValid() || from.isAfter(to)) {
    console.error("Ngày không hợp lệ, hoặc --from phải <= --to");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("DB connected");

  const activeUserCount = await UserInfo.countDocuments({ isDeleted: false });
  console.log(
    `Phạm vi kiểm tra: ${from.format("DD/MM/YYYY")} → ${to.format("DD/MM/YYYY")} (${activeUserCount} nhân viên active)\n`
  );

  let totalAdded = 0;
  const cursor = from.clone();

  while (cursor.isSameOrBefore(to, "day")) {
    const dateStr = cursor.format("DD/MM/YYYY");
    const before = await WorkSheet.countDocuments({ date: cursor.toDate(), isDeleted: false });

    await createDailyWorkSheets(cursor.toDate());

    const after = await WorkSheet.countDocuments({ date: cursor.toDate(), isDeleted: false });
    const added = after - before;
    totalAdded += added;

    if (added > 0) {
      console.log(`${dateStr}: bổ sung ${added} worksheet còn thiếu (${before} → ${after})`);
    } else {
      console.log(`${dateStr}: đủ hoặc bỏ qua (CN/ngày lễ) — ${after} worksheet`);
    }

    cursor.add(1, "day");
  }

  console.log(`\n✅ Backfill xong. Tổng bổ sung: ${totalAdded} worksheet.`);
  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Lỗi:", err);
    process.exit(1);
  });
