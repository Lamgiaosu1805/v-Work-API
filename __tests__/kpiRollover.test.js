const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { runDailyRollover } = require("../src/helpers/kpiRollover");
const KpiPeriodTargetModel = require("../src/models/KpiPeriodTargetModel");
const { KPI_SCOPE_TYPE, KPI_PERIOD_TYPE } = require("../src/constants");

let mongod;
const scopeId = new mongoose.Types.ObjectId();
const metricCode = "calls";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await KpiPeriodTargetModel.deleteMany({});
});

async function createDayRecord({ periodKey, baseTarget, rolloverIn = 0, actual = 0, isClosed = false }) {
  return KpiPeriodTargetModel.create({
    scope_type: KPI_SCOPE_TYPE.SALE,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: KPI_PERIOD_TYPE.DAY,
    period_key: periodKey,
    base_target: baseTarget,
    rollover_in: rolloverIn,
    effective_target: baseTarget + rolloverIn,
    actual,
    is_closed: isClosed
  });
}

function findDay(periodKey) {
  return KpiPeriodTargetModel.findOne({
    scope_type: KPI_SCOPE_TYPE.SALE,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: KPI_PERIOD_TYPE.DAY,
    period_key: periodKey
  }).lean();
}

function findMonth(periodKey) {
  return KpiPeriodTargetModel.findOne({
    scope_type: KPI_SCOPE_TYPE.SALE,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: KPI_PERIOD_TYPE.MONTH,
    period_key: periodKey
  }).lean();
}

describe("runDailyRollover", () => {
  test("hụt chỉ tiêu ngày T -> rollover_in/effective_target ngày T+1 đúng, ngày T bị đóng, tuần & tháng chứa T+1 cập nhật theo", async () => {
    await createDayRecord({ periodKey: "2026-06-15", baseTarget: 100, actual: 60 });
    await createDayRecord({ periodKey: "2026-06-16", baseTarget: 100 });

    const summary = await runDailyRollover({ date: new Date(2026, 5, 15) });

    expect(summary).toEqual({ processed: 1, updated: 1, skipped: 0, closed: 1 });

    const today = await findDay("2026-06-15");
    expect(today.is_closed).toBe(true);
    expect(today.closed_at).not.toBeNull();

    const tomorrow = await findDay("2026-06-16");
    expect(tomorrow.rollover_in).toBe(40);
    expect(tomorrow.base_target).toBe(100);
    expect(tomorrow.effective_target).toBe(140);

    const month = await findMonth("2026-06");
    expect(month.rollover_in).toBe(40);
  });

  test("đạt/vượt chỉ tiêu ngày T -> rollover ngày sau = 0 (không âm)", async () => {
    await createDayRecord({ periodKey: "2026-06-15", baseTarget: 100, actual: 150 });
    await createDayRecord({ periodKey: "2026-06-16", baseTarget: 100 });

    await runDailyRollover({ date: new Date(2026, 5, 15) });

    const tomorrow = await findDay("2026-06-16");
    expect(tomorrow.rollover_in).toBe(0);
    expect(tomorrow.effective_target).toBe(100);
  });

  test("ngày T+1 đã đóng từ trước -> bị skip, không ghi đè", async () => {
    await createDayRecord({ periodKey: "2026-06-15", baseTarget: 100, actual: 60 });
    await createDayRecord({
      periodKey: "2026-06-16",
      baseTarget: 100,
      rolloverIn: 5,
      isClosed: true
    });

    const summary = await runDailyRollover({ date: new Date(2026, 5, 15) });

    expect(summary.skipped).toBe(1);
    expect(summary.updated).toBe(0);

    const tomorrow = await findDay("2026-06-16");
    expect(tomorrow.rollover_in).toBe(5); // không đổi
  });

  test("ngày T+1 chưa có bản ghi (chưa decompose) -> tạo mới đúng base_target=0, rollover_in=shortfall", async () => {
    await createDayRecord({ periodKey: "2026-06-15", baseTarget: 100, actual: 60 });

    await runDailyRollover({ date: new Date(2026, 5, 15) });

    const tomorrow = await findDay("2026-06-16");
    expect(tomorrow).not.toBeNull();
    expect(tomorrow.base_target).toBe(0);
    expect(tomorrow.rollover_in).toBe(40);
    expect(tomorrow.effective_target).toBe(40);
  });

  test("chạy runDailyRollover 2 lần liên tiếp cho cùng ngày T -> kết quả không đổi (idempotent)", async () => {
    await createDayRecord({ periodKey: "2026-06-15", baseTarget: 100, actual: 60 });
    await createDayRecord({ periodKey: "2026-06-16", baseTarget: 100 });

    await runDailyRollover({ date: new Date(2026, 5, 15) });
    const first = await findDay("2026-06-16");

    await runDailyRollover({ date: new Date(2026, 5, 15) });
    const second = await findDay("2026-06-16");

    expect(second.rollover_in).toBe(first.rollover_in);
    expect(second.effective_target).toBe(first.effective_target);

    const month = await findMonth("2026-06");
    expect(month.rollover_in).toBe(40);
  });

  test("closedBy được set khi truyền vào (trigger thủ công qua API)", async () => {
    const closedBy = new mongoose.Types.ObjectId();
    await createDayRecord({ periodKey: "2026-06-15", baseTarget: 100, actual: 60 });
    await createDayRecord({ periodKey: "2026-06-16", baseTarget: 100 });

    await runDailyRollover({ date: new Date(2026, 5, 15), closedBy });

    const today = await findDay("2026-06-15");
    expect(String(today.closed_by)).toBe(String(closedBy));
  });
});
