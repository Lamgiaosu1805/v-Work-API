require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const WorkSheet = require("../src/models/WorkSheetModel");
const WorkDayStatus = require("../src/models/WorkDayStatusModel");

const TZ = "Asia/Ho_Chi_Minh";
const FROM = moment.tz("2026-04-26", TZ).startOf("day").toDate();
const TO   = moment.tz("2026-05-25", TZ).endOf("day").toDate();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("DB connected");

  const wsResult = await WorkSheet.deleteMany({ date: { $gte: FROM, $lte: TO } });
  const dsResult = await WorkDayStatus.deleteMany({ date: { $gte: FROM, $lte: TO } });

  console.log(`Đã xóa ${wsResult.deletedCount} worksheet, ${dsResult.deletedCount} work_day_status.`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
