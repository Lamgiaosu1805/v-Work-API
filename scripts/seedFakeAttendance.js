require("dotenv").config();
const mongoose = require("mongoose");
const moment = require("moment-timezone");
const UserInfo = require("../src/models/UserInfoModel");
const WorkSheet = require("../src/models/WorkSheetModel");
const WorkDayStatus = require("../src/models/WorkDayStatusModel");
const Shift = require("../src/models/ShiftModel");

const TZ = "Asia/Ho_Chi_Minh";
const FROM = moment.tz("2026-04-26", TZ).startOf("day");
const TO   = moment.tz("2026-05-25", TZ).startOf("day");

function randomStatus() {
  const r = Math.random();
  if (r < 0.65) return "present";
  if (r < 0.75) return "missed_clock";
  if (r < 0.83) return "absent";
  if (r < 0.90) return "leave_paid";
  if (r < 0.95) return "leave_unpaid";
  return "remote";
}

function randomMinutes(max) {
  return Math.floor(Math.random() * max);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("DB connected");

  const [adminShift, morningShift] = await Promise.all([
    Shift.findOne({ name: "Ca hành chính" }),
    Shift.findOne({ name: "Ca sáng" }),
  ]);
  if (!adminShift || !morningShift) {
    console.error("Không tìm thấy shift. Kiểm tra lại tên ca.");
    process.exit(1);
  }

  const users = await UserInfo.find({ isDeleted: false });
  console.log(`Tìm thấy ${users.length} user, bắt đầu seed từ ${FROM.format("DD/MM/YYYY")} đến ${TO.format("DD/MM/YYYY")}...`);

  let wsCreated = 0;
  let dsCreated = 0;

  const cursor = FROM.clone();
  while (cursor.isSameOrBefore(TO)) {
    const isSat = cursor.day() === 6;
    const isSun = cursor.day() === 0;

    if (!isSun) {
      const shift = isSat ? morningShift : adminShift;
      const [startH, startM] = shift.start_time.split(":").map(Number);
      const [endH, endM]     = shift.end_time.split(":").map(Number);

      for (const user of users) {
        const dateVal = cursor.toDate();

        const existing = await WorkSheet.findOne({ user_id: user._id, date: { $gte: cursor.toDate(), $lt: cursor.clone().add(1, "day").toDate() } });
        if (existing) continue;

        const status = randomStatus();
        const hasIn  = ["present", "missed_clock"].includes(status);
        const hasOut = status === "present";

        const lateMin  = hasIn  ? randomMinutes(30) : 0;
        const earlyMin = hasOut ? randomMinutes(20) : 0;

        const checkIn = hasIn
          ? cursor.clone().hour(startH).minute(startM + lateMin).second(0).toDate()
          : null;
        const checkOut = hasOut
          ? cursor.clone().hour(endH).minute(endM - earlyMin).second(0).toDate()
          : null;

        const ws = await WorkSheet.create({
          user_id:      user._id,
          date:         dateVal,
          shifts:       [shift._id],
          check_in:     checkIn,
          check_out:    checkOut,
          minutes_late: lateMin,
          minute_early: earlyMin,
        });
        wsCreated++;

        await WorkDayStatus.updateOne(
          { user_id: user._id, date: dateVal, period: "full" },
          { $setOnInsert: {
            worksheet_id: ws._id,
            status,
            sources: [{ ref_id: ws._id, ref_type: "system" }],
            isDeleted: false,
          }},
          { upsert: true },
        );
        dsCreated++;
      }
    }

    cursor.add(1, "day");
  }

  console.log(`Xong! Tạo ${wsCreated} worksheet, ${dsCreated} work_day_status.`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
