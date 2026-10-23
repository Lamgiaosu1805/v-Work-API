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
  registerHandbookAssistantJobs();
}

module.exports = { startCronJobs };
