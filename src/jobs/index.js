const { registerGenWorkSheetJob } = require("./genWorkSheet");
const { registerFinalizeWorkDayJob } = require("./finalizeWorkDay");
const { registerCleanupDeviceTokensJob } = require("./cleanupDeviceTokens");
const { registerWeeklyReportJobs } = require("./weeklyReportJob");
const { registerAccrueMonthlyLeaveJob } = require("./accrueMonthlyLeave");
// const { registerAutoRejectLeaveRequestsJob } = require("./autoRejectLeaveRequests");
const { registerChurnDetectionJob } = require("./churnDetectionJob");
const { registerSharedFolderCleanupJob } = require("./sharedFolderCleanupJob");
const { registerReconcileFecLeadCommissionJob } = require("./reconcileFecLeadCommission");
const { registerCustomerCareJobs } = require("./customerCareJob");
const { registerHandbookAssistantJobs } = require("./handbookAssistantJob");
const { registerTicketSweepJob } = require("./ticketSweepJob");

// DISABLE_CRON=1: không đăng ký cron nào — để chạy local/dev trỏ vào DB dùng chung (test) mà không
// làm các job (chốt công, cộng phép, đối soát hoa hồng, nhắc báo cáo...) ghi vào dữ liệu đó.
function isCronDisabled() {
  return ["1", "true"].includes(
    String(process.env.DISABLE_CRON ?? "")
      .trim()
      .toLowerCase()
  );
}

function startCronJobs() {
  if (isCronDisabled()) {
    console.log("⏸️  DISABLE_CRON bật — bỏ qua toàn bộ cron job");
    return;
  }
  registerGenWorkSheetJob();
  registerFinalizeWorkDayJob();
  registerCleanupDeviceTokensJob();
  registerWeeklyReportJobs();
  registerAccrueMonthlyLeaveJob();
  // registerAutoRejectLeaveRequestsJob();
  registerChurnDetectionJob();
  registerSharedFolderCleanupJob();
  registerReconcileFecLeadCommissionJob();
  registerCustomerCareJobs();
  registerHandbookAssistantJobs();
  registerTicketSweepJob();
}

module.exports = { startCronJobs };
