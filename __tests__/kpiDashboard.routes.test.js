const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const express = require("express");

jest.mock("../src/middlewares/authMiddleware", () => ({
  authenticate: (req, res, next) => {
    if (!req.account) return res.status(401).json({ message: "Chưa đăng nhập" });
    next();
  }
}));

jest.mock("../src/helpers/rbac", () => ({
  requirePermission: () => (req, res, next) => next()
}));

const UserInfoModel = require("../src/models/UserInfoModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const KpiMetricModel = require("../src/models/KpiMetricModel");
const KpiPeriodTargetModel = require("../src/models/KpiPeriodTargetModel");
const { KPI_SCOPE_TYPE, KPI_PERIOD_TYPE } = require("../src/constants");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.headers["x-test-account"];
    req.account = raw ? JSON.parse(raw) : null;
    next();
  });
  const kpiDashboardRouter = require("../src/routes/kpiDashboard");
  app.use("/kpi/dashboard", kpiDashboardRouter);
  return app;
}

let mongod;
let app;

const accountId = new mongoose.Types.ObjectId();
const saleInfoId = new mongoose.Types.ObjectId();
let ttkdId;

const asSale = { "x-test-account": JSON.stringify({ _id: accountId, role: "user" }) };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildApp();

  const ttkd = await DepartmentModel.create({
    department_name: "TTKD-TEST",
    department_code: "TTKD-DASH-TEST",
    type: "branch"
  });
  ttkdId = ttkd._id;

  await UserInfoModel.create({
    _id: saleInfoId,
    full_name: "Sale Test",
    cccd: "001199000111",
    phone_number: "0900000099",
    sex: 1,
    date_of_birth: new Date(1995, 0, 1),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: accountId,
    ma_nv: "NV-DASH-TEST",
    employment_type: "fulltime"
  });

  await UserDepartmentPositionModel.create({
    user: saleInfoId,
    department: ttkdId,
    position: new mongoose.Types.ObjectId()
  });

  await KpiMetricModel.create({
    code: "revenue",
    name: "Doanh số",
    group: "output",
    source: "auto",
    auto_source: "investment_revenue",
    order: 1
  });

  await KpiPeriodTargetModel.create({
    scope_type: KPI_SCOPE_TYPE.SALE,
    scope_id: saleInfoId,
    metric_code: "revenue",
    period_type: KPI_PERIOD_TYPE.MONTH,
    period_key: "2026-04",
    base_target: 100,
    rollover_in: 0,
    effective_target: 100,
    actual: 70,
    achievement_pct: 70
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /kpi/dashboard/me", () => {
  test("thiếu period_type/period_key -> 400", async () => {
    const res = await request(app).get("/kpi/dashboard/me").set(asSale);
    expect(res.status).toBe(400);
  });

  test("trả đúng metrics + clawbacks rỗng cho sale hiện tại", async () => {
    const res = await request(app)
      .get("/kpi/dashboard/me")
      .query({ period_type: "month", period_key: "2026-04" })
      .set(asSale);

    expect(res.status).toBe(200);
    expect(res.body.data.clawbacks).toEqual([]);
    const revenue = res.body.data.metrics.find((m) => m.metric_code === "revenue");
    expect(revenue.actual).toBe(70);
  });
});

describe("GET /kpi/dashboard/team", () => {
  test("trả tổng hợp ttkd + drill-down đúng sale trong ttkd", async () => {
    const res = await request(app)
      .get("/kpi/dashboard/team")
      .query({ period_type: "month", period_key: "2026-04" })
      .set(asSale);

    expect(res.status).toBe(200);
    expect(res.body.data.teams).toHaveLength(1);
    const team = res.body.data.teams[0];
    expect(String(team.ttkd_id)).toBe(String(ttkdId));
    expect(team.sales).toHaveLength(1);
    expect(String(team.sales[0].sale_id)).toBe(String(saleInfoId));
    const revenue = team.sales[0].metrics.find((m) => m.metric_code === "revenue");
    expect(revenue.actual).toBe(70);
  });
});
