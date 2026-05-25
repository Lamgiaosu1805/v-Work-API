const cron = require("node-cron");
const moment = require("moment-timezone");
const WorkSheetModel = require("../models/WorkSheetModel");
const WorkDayStatusModel = require("../models/WorkDayStatusModel");

const TZ = "Asia/Ho_Chi_Minh";

async function finalizeWorkDay() {
  try {
    const today = moment.tz(TZ).startOf("day").toDate();
    const tomorrow = moment.tz(TZ).startOf("day").add(1, "day").toDate();

    console.log(`[Cron] finalizeWorkDay: ${moment.tz(today, TZ).format("DD/MM/YYYY")}`);

    const fullSheets = await WorkSheetModel.find(
      { date: { $gte: today, $lt: tomorrow }, check_in: { $ne: null }, check_out: { $ne: null }, isDeleted: false },
      "_id",
    );
    if (fullSheets.length > 0) {
      await WorkDayStatusModel.updateMany(
        { date: { $gte: today, $lt: tomorrow }, status: "pending", worksheet_id: { $in: fullSheets.map((w) => w._id) }, isDeleted: false },
        { status: "present" },
      );
    }

    const missedOutSheets = await WorkSheetModel.find(
      { date: { $gte: today, $lt: tomorrow }, check_in: { $ne: null }, check_out: null, isDeleted: false },
      "_id",
    );
    if (missedOutSheets.length > 0) {
      await WorkDayStatusModel.updateMany(
        { date: { $gte: today, $lt: tomorrow }, status: "pending", worksheet_id: { $in: missedOutSheets.map((w) => w._id) }, isDeleted: false },
        { status: "missed_clock" },
      );
    }

    await WorkDayStatusModel.updateMany(
      { date: { $gte: today, $lt: tomorrow }, status: "pending", isDeleted: false },
      { status: "absent" },
    );

    console.log("[Cron] finalizeWorkDay hoàn tất.");
  } catch (error) {
    console.error("[Cron] Lỗi finalizeWorkDay:", error);
  }
}

cron.schedule("0 23 * * *", async () => {
  console.log("[Cron] Bắt đầu chạy finalizeWorkDay");
  await finalizeWorkDay();
}, { timezone: TZ });

module.exports = finalizeWorkDay;
