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

function startCronJobs() {
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
}

module.exports = { startCronJobs };
