const { registerGenWorkSheetJob } = require("./genWorkSheet");
const { registerFinalizeWorkDayJob } = require("./finalizeWorkDay");
const { registerCleanupDeviceTokensJob } = require("./cleanupDeviceTokens");
const { registerWeeklyReportJobs } = require("./weeklyReportJob");
const { registerAccrueMonthlyLeaveJob } = require("./accrueMonthlyLeave");
const { registerAutoRejectLeaveRequestsJob } = require("./autoRejectLeaveRequests");
const { registerChurnDetectionJob } = require("./churnDetectionJob");

function startCronJobs() {
  registerGenWorkSheetJob();
  registerFinalizeWorkDayJob();
  registerCleanupDeviceTokensJob();
  registerWeeklyReportJobs();
  registerAccrueMonthlyLeaveJob();
  registerAutoRejectLeaveRequestsJob();
  registerChurnDetectionJob();
}

module.exports = { startCronJobs };
