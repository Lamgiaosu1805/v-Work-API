const cron = require("node-cron");
const mongoose = require("mongoose");
const UserInfo = require("../models/UserInfoModel");
const WorkSchedule = require("../models/WorkScheduleModel");
const WorkSheet = require("../models/WorkSheetModel");
const Shift = require("../models/ShiftModel");

// Hàm chính tạo WorkSheet
async function createDailyWorkSheets() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = new Date(today);
        const end = new Date(today);
        end.setDate(end.getDate() + 1);

        const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // 1=Mon ... 7=Sun

        // Nếu là Chủ Nhật thì không chạy
        if (dayOfWeek === 7) {
            console.log(`📅 Hôm nay là Chủ Nhật, bỏ qua việc tạo worksheet.`);
            return;
        }

        console.log(`📅 [Cron] Bắt đầu tạo worksheet cho ngày ${today.toLocaleDateString("vi-VN")}`);

        // Lấy toàn bộ user active
        const users = await UserInfo.find({ isDeleted: false });
        const fulltimeUsers = users.filter(u => !u.employment_type || u.employment_type === "fulltime");
        const parttimeUsers = users.filter(u => u.employment_type === "parttime");

        // ---- FULLTIME ----
        let adminShift;
        let morningShift;

        // Lấy ca hành chính & ca sáng
        adminShift = await Shift.findOne({ name: "Ca hành chính" });
        morningShift = await Shift.findOne({ name: "Ca sáng" });

        if (!adminShift) console.warn("Không tìm thấy ca hành chính!");
        if (!morningShift) console.warn("Không tìm thấy ca sáng!");

        for (const user of fulltimeUsers) {
            // Nếu đã tồn tại sheet hôm nay thì bỏ
            const exist = await WorkSheet.findOne({
                user_id: user._id,
                date: { $gte: start, $lt: end }
            });
            if (exist) continue;

            // Nếu hôm nay là thứ 7 → tạo ca sáng
            if (dayOfWeek === 6) {
                if (morningShift) {
                    await WorkSheet.create({
                        user_id: user._id,
                        date: today,
                        shifts: [morningShift._id],
                        mergedShift: false,
                        status: "pending",
                    });
                }
                continue;
            }

            // Các ngày từ thứ 2 → thứ 6 dùng ca hành chính
            if (adminShift) {
                await WorkSheet.create({
                    user_id: user._id,
                    date: today,
                    shifts: [adminShift._id],
                    mergedShift: true,
                    status: "pending",
                });
            }
        }

        // ---- PARTTIME ----
        for (const user of parttimeUsers) {
            const workSchedule = await WorkSchedule.find({ userId: user._id, dayOfWeek }).populate("shifts");
            if (!workSchedule || workSchedule.length === 0) continue;

            const exist = await WorkSheet.findOne({
                user_id: user._id,
                date: { $gte: start, $lt: end }
            });
            if (exist) continue;

            // Merge ca nếu >1 ca trong ngày
            const shiftsToday = workSchedule.flatMap(ws => ws.shifts);
            const mergedShift = shiftsToday.length > 1;

            await WorkSheet.create({
                user_id: user._id,
                date: today,
                shifts: shiftsToday.map(s => s._id),
                mergedShift,
                status: "pending",
            });
        }

        console.log("✅ Cron tạo WorkSheet hằng ngày hoàn tất!");
    } catch (error) {
        console.error("❌ Lỗi cron createDailyWorkSheets:", error);
    }
}

// Lên lịch chạy lúc 00:05 mỗi ngày
cron.schedule("1 0 * * *", async () => {
    console.log("🕐 [Cron] Bắt đầu chạy createDailyWorkSheets");
    await createDailyWorkSheets();
});

module.exports = createDailyWorkSheets;
