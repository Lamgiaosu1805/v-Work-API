const cron = require("node-cron");
const moment = require("moment-timezone");
const UserInfo = require("../models/UserInfoModel");
const WorkSchedule = require("../models/WorkScheduleModel");
const WorkSheet = require("../models/WorkSheetModel");
const WorkDayStatus = require("../models/WorkDayStatusModel");
const HolidayModel = require("../models/HolidayModel");
const Shift = require("../models/ShiftModel");

const TZ = "Asia/Ho_Chi_Minh";

async function ensurePendingStatus(userId, worksheetId, date) {
  await WorkDayStatus.updateOne(
    { user_id: userId, date, period: "full" },
    {
      $setOnInsert: {
        worksheet_id: worksheetId,
        status: "pending",
        sources: [{ ref_id: worksheetId, ref_type: "system" }],
        isDeleted: false
      }
    },
    { upsert: true }
  );
}

async function createDailyWorkSheets(targetDate) {
  try {
    const refMoment = targetDate ? moment.tz(targetDate, TZ) : moment.tz(TZ);
    const today = refMoment.clone().startOf("day").toDate();
    const dayOfWeek = refMoment.day() === 0 ? 7 : refMoment.day();

    if (dayOfWeek === 7) {
      console.log("[Cron] Hôm nay là Chủ Nhật, bỏ qua việc tạo worksheet.");
      return;
    }

    const todayHolidays = await HolidayModel.find({ date: today, isDeleted: false });
    const globalHoliday = todayHolidays.find((h) => h.scope_type === "all");
    if (globalHoliday) {
      console.log(
        `[Cron] Hôm nay là ngày lễ toàn công ty (${globalHoliday.name}), bỏ qua việc tạo worksheet.`
      );
      return;
    }

    const branchHolidayIds = new Set(
      todayHolidays
        .filter((h) => h.scope_type === "branch")
        .flatMap((h) => h.branches.map((b) => b.toString()))
    );

    console.log(
      `[Cron] Bắt đầu tạo worksheet cho ngày ${moment.tz(today, TZ).format("DD/MM/YYYY")}`
    );

    const users = await UserInfo.find({ isDeleted: false });

    const isOnHoliday = (user) =>
      branchHolidayIds.size > 0 &&
      user.branch_id &&
      branchHolidayIds.has(user.branch_id.toString());

    const fulltimeUsers = users.filter(
      (u) => !isOnHoliday(u) && (!u.employment_type || u.employment_type === "fulltime")
    );
    const parttimeUsers = users.filter((u) => !isOnHoliday(u) && u.employment_type === "parttime");

    const [adminShift, morningShift] = await Promise.all([
      Shift.findOne({ name: "Ca hành chính" }),
      Shift.findOne({ name: "Ca sáng" })
    ]);

    if (!adminShift) console.warn("[Cron] Không tìm thấy ca hành chính!");
    if (!morningShift) console.warn("[Cron] Không tìm thấy ca sáng!");

    for (const user of fulltimeUsers) {
      const shift = dayOfWeek === 6 ? morningShift : adminShift;
      if (!shift) continue;

      const worksheet = await WorkSheet.findOneAndUpdate(
        { user_id: user._id, date: today },
        { $setOnInsert: { shifts: [shift._id] } },
        { upsert: true, new: true }
      );
      await ensurePendingStatus(user._id, worksheet._id, today);
    }

    for (const user of parttimeUsers) {
      const workSchedule = await WorkSchedule.find({ userId: user._id, dayOfWeek }).populate(
        "shifts"
      );
      if (!workSchedule || workSchedule.length === 0) continue;

      const shiftsToday = workSchedule.flatMap((ws) => ws.shifts);
      const worksheet = await WorkSheet.findOneAndUpdate(
        { user_id: user._id, date: today },
        { $setOnInsert: { shifts: shiftsToday.map((s) => s._id) } },
        { upsert: true, new: true }
      );
      await ensurePendingStatus(user._id, worksheet._id, today);
    }

    console.log("[Cron] Tạo WorkSheet hằng ngày hoàn tất!");
  } catch (error) {
    console.error("[Cron] Lỗi createDailyWorkSheets:", error);
  }
}

function registerGenWorkSheetJob() {
  cron.schedule(
    "1 0 * * *",
    async () => {
      console.log("[Cron] Bắt đầu chạy createDailyWorkSheets");
      await createDailyWorkSheets();
    },
    { timezone: TZ }
  );
}

module.exports = { createDailyWorkSheets, registerGenWorkSheetJob };
