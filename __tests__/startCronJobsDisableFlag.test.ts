// DISABLE_CRON: bật thì startCronJobs() không đăng ký job nào; tắt/không đặt thì đăng ký đủ.
const JOB_MODULES: Record<string, string> = {
  "../src/jobs/genWorkSheet": "registerGenWorkSheetJob",
  "../src/jobs/finalizeWorkDay": "registerFinalizeWorkDayJob",
  "../src/jobs/cleanupDeviceTokens": "registerCleanupDeviceTokensJob",
  "../src/jobs/weeklyReportJob": "registerWeeklyReportJobs",
  "../src/jobs/accrueMonthlyLeave": "registerAccrueMonthlyLeaveJob",
  "../src/jobs/churnDetectionJob": "registerChurnDetectionJob",
  "../src/jobs/sharedFolderCleanupJob": "registerSharedFolderCleanupJob",
  "../src/jobs/reconcileFecLeadCommission": "registerReconcileFecLeadCommissionJob",
  "../src/jobs/customerCareJob": "registerCustomerCareJobs",
  "../src/jobs/handbookAssistantJob": "registerHandbookAssistantJobs"
};

function loadStartCronJobs(): { startCronJobs: () => void; registers: jest.Mock[] } {
  const registers: jest.Mock[] = [];
  jest.resetModules();
  Object.entries(JOB_MODULES).forEach(([modulePath, exportName]) => {
    const register = jest.fn();
    registers.push(register);
    jest.doMock(modulePath, () => ({ [exportName]: register }));
  });
  // eslint-disable-next-line global-require
  const { startCronJobs } = require("../src/jobs");
  return { startCronJobs, registers };
}

describe("startCronJobs + DISABLE_CRON", () => {
  const original = process.env.DISABLE_CRON;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    if (original === undefined) delete process.env.DISABLE_CRON;
    else process.env.DISABLE_CRON = original;
  });

  it.each(["1", "true", "TRUE", " 1 "])("DISABLE_CRON=%j → không đăng ký job nào", (value) => {
    process.env.DISABLE_CRON = value;
    const { startCronJobs, registers } = loadStartCronJobs();
    startCronJobs();
    registers.forEach((register) => expect(register).not.toHaveBeenCalled());
  });

  it.each([undefined, "", "0", "false"])("DISABLE_CRON=%j → đăng ký đủ mọi job", (value) => {
    if (value === undefined) delete process.env.DISABLE_CRON;
    else process.env.DISABLE_CRON = value;
    const { startCronJobs, registers } = loadStartCronJobs();
    startCronJobs();
    registers.forEach((register) => expect(register).toHaveBeenCalledTimes(1));
    expect(registers).toHaveLength(10);
  });
});
