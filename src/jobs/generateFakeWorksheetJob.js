const cron = require("node-cron");
const mongoose = require("mongoose");
const UserInfo = require("../models/UserInfoModel");
const WorkSheet = require("../models/WorkSheetModel");
const Shift = require("../models/ShiftModel");

// -------------------------
// JOB TẠO WORKSHEET ẢO
// -------------------------
async function generateFakeWorksheetJob() {
    try {
        console.log("🚀 [Job] Bắt đầu tạo dữ liệu WorkSheet ảo…");

        const startDate = new Date("2025-08-26");
        const endDate = new Date("2025-09-25");

        const adminShift = await Shift.findOne({ name: "Ca hành chính" });
        const morningShift = await Shift.findOne({ name: "Ca sáng" });

        if (!adminShift || !morningShift) {
            console.log("❌ Không tìm thấy shift trong DB");
            return;
        }

        const adminShiftStart = { hour: 8, min: 0 };
        const adminShiftEnd = { hour: 17, min: 30 };

        const morningStart = { hour: 8, min: 0 };
        const morningEnd = { hour: 12, min: 0 };

        const users = await UserInfo.find({ isDeleted: false });

        let current = new Date(startDate);

        while (current <= endDate) {
            const dayOfWeek = current.getDay() === 0 ? 7 : current.getDay(); // Chủ nhật = 7

            if (dayOfWeek !== 7) {
                for (const user of users) {
                    // Check tồn tại
                    const exist = await WorkSheet.findOne({
                        user_id: user._id,
                        date: {
                            $gte: new Date(current.setHours(0, 0, 0, 0)),
                            $lt: new Date(current.setHours(0, 0, 0, 0)),
                        },
                    });

                    if (exist) continue;

                    let shiftId;
                    let shiftStart, shiftEnd;
                    let mergedShift = true;

                    // Thứ 7 → Ca sáng
                    if (dayOfWeek === 6) {
                        shiftId = morningShift._id;
                        shiftStart = morningStart;
                        shiftEnd = morningEnd;
                        mergedShift = false;
                    } else {
                        shiftId = adminShift._id;
                        shiftStart = adminShiftStart;
                        shiftEnd = adminShiftEnd;
                    }

                    // Random đi muộn / về sớm
                    const late = Math.floor(Math.random() * 16);
                    const early = Math.floor(Math.random() * 16);

                    const checkIn = new Date(current);
                    checkIn.setHours(shiftStart.hour, shiftStart.min + late, 0, 0);

                    const checkOut = new Date(current);
                    checkOut.setHours(shiftEnd.hour, shiftEnd.min - early, 0, 0);

                    // Tạo worksheet
                    await WorkSheet.create({
                        user_id: user._id,
                        date: new Date(current),
                        shifts: [shiftId],
                        mergedShift,
                        status: "present",
                        check_in: checkIn,
                        check_out: checkOut,
                        minutes_late: late,
                        minute_early: early,
                    });
                }
            }

            current.setDate(current.getDate() + 1);
        }

        console.log("🎉 [Job] Tạo WorkSheet ảo hoàn tất!");
    } catch (err) {
        console.error("❌ Lỗi job generateFakeWorksheetJob:", err);
    }
}

// -------------------------
// LỊCH CHẠY JOB
// -------------------------

// Chạy 1 lần/ngày lúc 00:10
cron.schedule("28 14 * * *", async () => {
    console.log("🕒 [Cron] Running generateFakeWorksheetJob()");
    await generateFakeWorksheetJob();
});

module.exports = generateFakeWorksheetJob;
