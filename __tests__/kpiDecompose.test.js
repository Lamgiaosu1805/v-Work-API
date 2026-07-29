const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const {
  computeDayTargets,
  rollupWeekTarget,
  rollupMonthTarget,
  decomposeAssignment
} = require("../src/helpers/kpiDecompose");
const { weekKey, weekRange } = require("../src/helpers/kpiPeriod");
const KpiPeriodTargetModel = require("../src/models/KpiPeriodTargetModel");
const { KPI_SCOPE_TYPE, KPI_PERIOD_TYPE } = require("../src/constants");

describe("computeDayTargets", () => {
  test("phân bổ đều và dồn phần dư làm tròn vào ngày cuối để tổng khớp chính xác monthTarget", () => {
    const workingDays = [new Date(2026, 0, 1), new Date(2026, 0, 2), new Date(2026, 0, 3)];
    const results = computeDayTargets(100, workingDays);

    const sum = results.reduce((acc, r) => acc + r.base_target, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
    expect(results).toHaveLength(3);
    expect(results[0].base_target).toBe(33.33);
    expect(results[1].base_target).toBe(33.33);
    expect(results[2].base_target).toBe(33.34);
  });

  test("workingDays rỗng trả về mảng rỗng, không chia cho 0", () => {
    expect(computeDayTargets(100, [])).toEqual([]);
  });

  test("monthTarget = 0 trả về base_target = 0 cho mọi ngày", () => {
    const workingDays = [new Date(2026, 0, 1), new Date(2026, 0, 2)];
    const results = computeDayTargets(0, workingDays);
    expect(results.every((r) => r.base_target === 0)).toBe(true);
  });
});

describe("weekKey / weekRange", () => {
  test("round-trip: weekRange(weekKey(date)) chứa lại chính date đó", () => {
    const date = new Date(2026, 5, 29);
    const key = weekKey(date);
    const { start, end } = weekRange(key);
    expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(date.getTime()).toBeLessThan(end.getTime());
  });

  test("xử lý đúng biên năm ISO week (cuối tháng 12 có thể thuộc tuần 1 năm sau)", () => {
    const date = new Date(2025, 11, 31);
    const key = weekKey(date);
    const { start, end } = weekRange(key);
    expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(date.getTime()).toBeLessThan(end.getTime());
  });
});

describe("rollupMonthTarget / rollupWeekTarget (DB)", () => {
  let mongod;
  const scopeId = new mongoose.Types.ObjectId();
  const metricCode = "test_metric";

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

  async function createDay(dateKey, baseTarget, rolloverIn = 0) {
    await KpiPeriodTargetModel.create({
      scope_type: KPI_SCOPE_TYPE.SALE,
      scope_id: scopeId,
      metric_code: metricCode,
      period_type: KPI_PERIOD_TYPE.DAY,
      period_key: dateKey,
      base_target: baseTarget,
      rollover_in: rolloverIn,
      effective_target: baseTarget + rolloverIn
    });
  }

  test("rollupMonthTarget sum đúng base_target và rollover_in của mọi ngày trong tháng", async () => {
    await createDay("2026-06-01", 10, 2);
    await createDay("2026-06-15", 20, 0);
    await createDay("2026-06-30", 15, 3);
    // ngày thuộc tháng khác không được tính vào
    await createDay("2026-07-01", 100, 100);

    const month = await rollupMonthTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      metricCode,
      year: 2026,
      month: 6
    });

    expect(month.period_type).toBe(KPI_PERIOD_TYPE.MONTH);
    expect(month.period_key).toBe("2026-06");
    expect(month.base_target).toBe(45);
    expect(month.rollover_in).toBe(5);
    expect(month.effective_target).toBe(50);
  });

  test("rollupWeekTarget sum đúng base_target và rollover_in của các ngày trong tuần", async () => {
    // Tuần ISO chứa 2026-06-29 (thứ Hai) đến 2026-07-05 (Chủ nhật)
    await createDay("2026-06-29", 10, 5);
    await createDay("2026-06-30", 10, 0);

    const wKey = weekKey(new Date(2026, 5, 29));
    const week = await rollupWeekTarget({ scopeType: KPI_SCOPE_TYPE.SALE, scopeId, metricCode, wKey });

    expect(week.base_target).toBe(20);
    expect(week.rollover_in).toBe(5);
    expect(week.effective_target).toBe(25);
  });

  test("gọi rollupMonthTarget/rollupWeekTarget nhiều lần cho kết quả giống nhau (idempotent)", async () => {
    await createDay("2026-06-01", 10, 2);

    await rollupMonthTarget({ scopeType: KPI_SCOPE_TYPE.SALE, scopeId, metricCode, year: 2026, month: 6 });
    const second = await rollupMonthTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      metricCode,
      year: 2026,
      month: 6
    });

    expect(second.base_target).toBe(10);
    expect(second.rollover_in).toBe(2);
    expect(second.effective_target).toBe(12);
  });
});

describe("decomposeAssignment ghi luôn base_target cấp tháng", () => {
  let mongod;

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

  test("activate assignment -> bản ghi tháng (kpi_period_target) có base_target = tổng target đã gán", async () => {
    const saleId = new mongoose.Types.ObjectId();
    const assignment = {
      sale_id: saleId,
      year: 2026,
      month: 6,
      items: [{ metric_code: "calls", target: 300 }]
    };

    const result = await decomposeAssignment({ assignment, previousItems: [] });
    expect(result.month).toEqual([{ metric_code: "calls", base_target: 300 }]);

    const monthRecord = await KpiPeriodTargetModel.findOne({
      scope_type: KPI_SCOPE_TYPE.SALE,
      scope_id: saleId,
      metric_code: "calls",
      period_type: KPI_PERIOD_TYPE.MONTH,
      period_key: "2026-06"
    }).lean();

    expect(monthRecord).not.toBeNull();
    expect(monthRecord.base_target).toBe(300);
    expect(monthRecord.effective_target).toBe(300);
  });
});
