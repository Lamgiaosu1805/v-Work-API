const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { syncCifEkyc } = require("../src/helpers/kpiSync");
const CustomerModel = require("../src/models/CustomerModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const KpiMetricModel = require("../src/models/KpiMetricModel");
const KpiPeriodTargetModel = require("../src/models/KpiPeriodTargetModel");
const { KPI_SCOPE_TYPE, KPI_PERIOD_TYPE, KPI_AUTO_SOURCE } = require("../src/constants");

let mongod;
const appId = new mongoose.Types.ObjectId();
const saleId = new mongoose.Types.ObjectId();
const otherSaleId = new mongoose.Types.ObjectId();
let ttkdId;

// code catalog thật khác auto_source (giống seed thật trong scripts/seedKpiMetrics.js)
const CIF_CODE = "cif_new";
const EKYC_CODE = "ekyc";

async function seedMetrics({ cif = true, ekyc = true } = {}) {
  const docs = [];
  if (cif) {
    docs.push({
      code: CIF_CODE,
      name: "CIF mới",
      group: "output",
      source: "auto",
      auto_source: KPI_AUTO_SOURCE.CIF
    });
  }
  if (ekyc) {
    docs.push({
      code: EKYC_CODE,
      name: "eKYC thành công",
      group: "output",
      source: "auto",
      auto_source: KPI_AUTO_SOURCE.EKYC
    });
  }
  if (docs.length) await KpiMetricModel.create(docs);
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const ttkd = await DepartmentModel.create({
    department_name: "TTKD-TEST",
    department_code: "TTKD-TEST",
    type: "branch"
  });
  ttkdId = ttkd._id;

  await UserDepartmentPositionModel.create({
    user: saleId,
    department: ttkdId,
    position: new mongoose.Types.ObjectId()
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await CustomerModel.deleteMany({});
  await KpiPeriodTargetModel.deleteMany({});
  await KpiMetricModel.deleteMany({});
});

function findTarget({ scopeType, scopeId, metricCode, periodType, periodKey }) {
  return KpiPeriodTargetModel.findOne({
    scope_type: scopeType,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: periodType,
    period_key: periodKey
  }).lean();
}

describe("syncCifEkyc", () => {
  test("đếm đúng cif/ekyc theo tháng, cấp ngày, cấp sale và ttkd (dùng đúng code catalog, khác auto_source)", async () => {
    await seedMetrics();
    await CustomerModel.create([
      {
        app_id: appId,
        phone_number: "0900000001",
        cif_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 10) },
        ekyc_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 10) }
      },
      {
        app_id: appId,
        phone_number: "0900000002",
        ekyc_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 12) }
      },
      {
        app_id: appId,
        phone_number: "0900000003",
        cif_commission: { sale_id: saleId, granted_at: new Date(2026, 4, 28) } // tháng trước, không tính
      },
      {
        app_id: appId,
        phone_number: "0900000004"
        // chưa được gán sale nào -> không tính
      }
    ]);

    const summary = await syncCifEkyc({ year: 2026, month: 6, ttkdId: null });
    expect(summary.customers_processed).toBe(2);
    expect(summary.metrics).toEqual([CIF_CODE, EKYC_CODE]);

    const cifMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: CIF_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(cifMonth.actual).toBe(1);

    const cifDay = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: CIF_CODE,
      periodType: KPI_PERIOD_TYPE.DAY,
      periodKey: "2026-06-10"
    });
    expect(cifDay.actual).toBe(1);

    const ekycMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: EKYC_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(ekycMonth.actual).toBe(2);

    const ekycTtkdMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.TTKD,
      scopeId: ttkdId,
      metricCode: EKYC_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(ekycTtkdMonth.actual).toBe(2);
  });

  test("kỳ đã is_closed thì không bị ghi đè", async () => {
    await seedMetrics();
    await CustomerModel.create({
      app_id: appId,
      phone_number: "0900000005",
      cif_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 10) }
    });

    await KpiPeriodTargetModel.create({
      scope_type: KPI_SCOPE_TYPE.SALE,
      scope_id: saleId,
      metric_code: CIF_CODE,
      period_type: KPI_PERIOD_TYPE.MONTH,
      period_key: "2026-06",
      base_target: 0,
      rollover_in: 0,
      effective_target: 0,
      actual: 99,
      is_closed: true
    });

    const summary = await syncCifEkyc({ year: 2026, month: 6, ttkdId: null });
    expect(summary.records_updated).toBe(3); // 4 agg entries (sale/ttkd x day/month), 1 bị skip vì is_closed

    const cifMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: CIF_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(cifMonth.actual).toBe(99);
  });

  test("lọc theo ttkdId -> chỉ tính sale thuộc đúng TTKD", async () => {
    await seedMetrics();
    await CustomerModel.create([
      {
        app_id: appId,
        phone_number: "0900000006",
        cif_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 15) }
      },
      {
        app_id: appId,
        phone_number: "0900000007",
        cif_commission: { sale_id: otherSaleId, granted_at: new Date(2026, 5, 15) }
      }
    ]);

    const summary = await syncCifEkyc({ year: 2026, month: 6, ttkdId });
    expect(summary.customers_processed).toBe(1);

    const cifMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: CIF_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(cifMonth.actual).toBe(1);
  });

  test("chạy 2 lần liên tiếp cho cùng tháng -> kết quả không đổi (idempotent)", async () => {
    await seedMetrics();
    await CustomerModel.create({
      app_id: appId,
      phone_number: "0900000008",
      cif_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 20) }
    });

    await syncCifEkyc({ year: 2026, month: 6, ttkdId: null });
    await syncCifEkyc({ year: 2026, month: 6, ttkdId: null });

    const cifMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: CIF_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(cifMonth.actual).toBe(1);
  });

  test("kpi_metric của cif chưa được seed/active -> bỏ qua cif, vẫn tính ekyc bình thường, không lỗi", async () => {
    await seedMetrics({ cif: false, ekyc: true });
    await CustomerModel.create({
      app_id: appId,
      phone_number: "0900000009",
      cif_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 10) },
      ekyc_commission: { sale_id: saleId, granted_at: new Date(2026, 5, 10) }
    });

    const summary = await syncCifEkyc({ year: 2026, month: 6, ttkdId: null });
    expect(summary.metrics).toEqual([EKYC_CODE]);
    expect(summary.customers_processed).toBe(1);

    const cifMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: CIF_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(cifMonth).toBeNull();

    const ekycMonth = await findTarget({
      scopeType: KPI_SCOPE_TYPE.SALE,
      scopeId: saleId,
      metricCode: EKYC_CODE,
      periodType: KPI_PERIOD_TYPE.MONTH,
      periodKey: "2026-06"
    });
    expect(ekycMonth.actual).toBe(1);
  });
});
