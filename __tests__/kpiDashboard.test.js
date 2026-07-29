const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { getPeriodSnapshot, getScopeMetrics } = require("../src/helpers/kpiDashboard");
const KpiMetricModel = require("../src/models/KpiMetricModel");
const KpiPeriodTargetModel = require("../src/models/KpiPeriodTargetModel");
const { KPI_SCOPE_TYPE, KPI_PERIOD_TYPE } = require("../src/constants");

let mongod;
const scopeId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await KpiMetricModel.deleteMany({});
  await KpiPeriodTargetModel.deleteMany({});
});

async function createMonth({ metricCode, periodKey, baseTarget, actual }) {
  return KpiPeriodTargetModel.create({
    scope_type: KPI_SCOPE_TYPE.SALE,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: KPI_PERIOD_TYPE.MONTH,
    period_key: periodKey,
    base_target: baseTarget,
    rollover_in: 0,
    effective_target: baseTarget,
    actual,
    achievement_pct: baseTarget > 0 ? Math.round((actual / baseTarget) * 10000) / 100 : 0
  });
}

describe("getPeriodSnapshot", () => {
  test("period_type=month -> đọc thẳng bản ghi có sẵn", async () => {
    await createMonth({ metricCode: "revenue", periodKey: "2026-04", baseTarget: 100, actual: 80 });

    const snapshot = await getPeriodSnapshot({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      metricCode: "revenue",
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-04"
    });

    expect(snapshot.base_target).toBe(100);
    expect(snapshot.actual).toBe(80);
    expect(snapshot.achievement_pct).toBe(80);
    expect(snapshot.aggregated).toBe(false);
  });

  test("period_type=month chưa có bản ghi -> trả snapshot rỗng, không lỗi", async () => {
    const snapshot = await getPeriodSnapshot({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      metricCode: "revenue",
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-04"
    });

    expect(snapshot.base_target).toBe(0);
    expect(snapshot.actual).toBe(0);
  });

  test("period_type=quarter -> sum đúng 3 tháng, kể cả tháng thiếu dữ liệu tính là 0", async () => {
    await createMonth({ metricCode: "revenue", periodKey: "2026-04", baseTarget: 100, actual: 80 });
    await createMonth({ metricCode: "revenue", periodKey: "2026-05", baseTarget: 100, actual: 120 });
    // 2026-06 không có bản ghi -> coi như 0

    const snapshot = await getPeriodSnapshot({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      metricCode: "revenue",
      periodType: KPI_PERIOD_TYPE.QUARTER,
      periodKey: "2026-Q2"
    });

    expect(snapshot.base_target).toBe(200);
    expect(snapshot.actual).toBe(200);
    expect(snapshot.effective_target).toBe(200);
    expect(snapshot.achievement_pct).toBe(100);
    expect(snapshot.aggregated).toBe(true);
  });

  test("period_type=year -> sum đúng 12 tháng", async () => {
    for (let m = 1; m <= 12; m++) {
      await createMonth({
        metricCode: "revenue",
        periodKey: `2026-${String(m).padStart(2, "0")}`,
        baseTarget: 10,
        actual: 5
      });
    }

    const snapshot = await getPeriodSnapshot({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      metricCode: "revenue",
      periodType: KPI_PERIOD_TYPE.YEAR,
      periodKey: "2026"
    });

    expect(snapshot.base_target).toBe(120);
    expect(snapshot.actual).toBe(60);
    expect(snapshot.achievement_pct).toBe(50);
  });
});

describe("getScopeMetrics", () => {
  test("trả đủ toàn bộ metric active, kể cả metric chưa có dữ liệu kỳ này", async () => {
    await KpiMetricModel.create([
      { code: "revenue", name: "Doanh số", group: "output", source: "auto", auto_source: "investment_revenue", order: 1 },
      { code: "calls", name: "Cuộc gọi", group: "input", source: "manual", auto_source: null, order: 2 },
      { code: "inactive_metric", name: "Đã tắt", group: "input", source: "manual", auto_source: null, is_active: false, order: 3 }
    ]);
    await createMonth({ metricCode: "revenue", periodKey: "2026-04", baseTarget: 100, actual: 80 });
    // "calls" không có bản ghi kpi_period_target nào -> vẫn phải xuất hiện trong kết quả với actual=0

    const metrics = await getScopeMetrics({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-04"
    });

    expect(metrics).toHaveLength(2); // không tính inactive_metric
    const revenue = metrics.find((m) => m.metric_code === "revenue");
    const calls = metrics.find((m) => m.metric_code === "calls");
    expect(revenue.actual).toBe(80);
    expect(calls.actual).toBe(0);
    expect(calls.metric_name).toBe("Cuộc gọi");
  });
});
