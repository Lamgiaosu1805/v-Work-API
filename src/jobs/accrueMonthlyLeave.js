const cron = require("node-cron");
const UserInfoModel = require("../models/UserInfoModel");
const EmploymentStatusModel = require("../models/EmploymentStatusModel");
const LeaveBalanceModel = require("../models/LeaveBalanceModel");
const { MONTHLY_ACCRUAL } = require("../config/common/leaveConfig");
const { LEAVE_BALANCE_REASON } = require("../constants");

// Không qua adjustLeaveBalance/lock: cron là single-writer, amount luôn dương
// (không bao giờ trigger chặn âm), và khóa+SUM từng nhân viên chỉ tốn overhead
// vô ích ở quy mô N nhân viên mỗi tháng 1 lần.
async function accrueMonthlyLeave() {
  try {
    console.log("[Cron] Bắt đầu cộng ngày phép tháng mới...");

    const accrueStatuses = await EmploymentStatusModel.find(
      { accrues_annual_leave: true, isDeleted: false },
      { _id: 1 }
    );
    const accrueIds = accrueStatuses.map((s) => s._id);

    const eligibleUsers = await UserInfoModel.find(
      { isDeleted: false, employment_status: { $in: accrueIds } },
      { _id: 1 }
    );

    if (!eligibleUsers.length) {
      console.log("[Cron] Không có nhân viên nào đủ điều kiện cộng phép.");
      return;
    }

    const rows = eligibleUsers.map((u) => ({
      user_id: u._id,
      amount: MONTHLY_ACCRUAL,
      reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL,
      ref_type: "system",
      created_by: null
    }));

    const result = await LeaveBalanceModel.insertMany(rows, { ordered: false });

    console.log(`[Cron] Đã cộng ${MONTHLY_ACCRUAL} ngày phép cho ${result.length} nhân viên.`);
  } catch (error) {
    console.error("[Cron] Lỗi accrueMonthlyLeave:", error);
  }
}

function registerAccrueMonthlyLeaveJob() {
  cron.schedule(
    "0 0 1 * *",
    async () => {
      await accrueMonthlyLeave();
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  );
}

module.exports = { accrueMonthlyLeave, registerAccrueMonthlyLeaveJob };
