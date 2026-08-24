const { registerGenWorkSheetJob } = require("./genWorkSheet");
const { registerFinalizeWorkDayJob } = require("./finalizeWorkDay");
const { registerCleanupDeviceTokensJob } = require("./cleanupDeviceTokens");
const { registerWeeklyReportJobs } = require("./weeklyReportJob");
const { registerAccrueMonthlyLeaveJob } = require("./accrueMonthlyLeave");
// const { registerAutoRejectLeaveRequestsJob } = require("./autoRejectLeaveRequests");
const { registerChurnDetectionJob } = require("./churnDetectionJob");
const { registerKpiSyncJob } = require("./kpiSyncJob");
const { registerKpiRolloverJob } = require("./kpiRolloverJob");
const { registerSharedFolderCleanupJob } = require("./sharedFolderCleanupJob");

function startCronJobs() {
  registerGenWorkSheetJob();
  registerFinalizeWorkDayJob();
  registerCleanupDeviceTokensJob();
  registerWeeklyReportJobs();
  registerAccrueMonthlyLeaveJob();
  // registerAutoRejectLeaveRequestsJob();
  registerChurnDetectionJob();
  registerKpiSyncJob();
  registerKpiRolloverJob();
  registerSharedFolderCleanupJob();
}

module.exports = { startCronJobs };
