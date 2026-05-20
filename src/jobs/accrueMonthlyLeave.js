const cron = require("node-cron");
const UserInfoModel = require("../models/UserInfoModel");
const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");

async function accrueMonthlyLeave() {
    try {
        console.log("[Cron] Bắt đầu cộng ngày phép tháng mới...");

        const result = await UserInfoModel.updateMany(
            { isDeleted: false },
            { $inc: { "leave_balance.annual": MONTHLY_ACCRUAL } },
        );

        console.log(`[Cron] Đã cộng ${MONTHLY_ACCRUAL} ngày phép cho ${result.modifiedCount} nhân viên.`);
    } catch (error) {
        console.error("[Cron] Lỗi accrueMonthlyLeave:", error);
    }
}

cron.schedule("0 0 1 * *", async () => {
    await accrueMonthlyLeave();
}, { timezone: "Asia/Ho_Chi_Minh" });

module.exports = accrueMonthlyLeave;
