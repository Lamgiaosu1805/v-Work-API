const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const express = require("express");

// authenticate/requirePermission thật vẫn chạy (không mock rbac) — chỉ mock authMiddleware
// để inject req.account từ header, giống kpiMetric.test.js.
jest.mock("../src/middlewares/authMiddleware", () => ({
  authenticate: (req, res, next) => {
    if (!req.account) return res.status(401).json({ message: "Chưa đăng nhập" });
    next();
  },
  isAdmin: (req, res, next) => next(),
  isManager: (req, res, next) => next(),
  hasModuleAccess: () => (req, res, next) => next(),
  canManage: () => (req, res, next) => next(),
  hasCrmAccess: (req, res, next) => next()
}));

const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const PositionModel = require("../src/models/PositionModel");
const KpiMetricModel = require("../src/models/KpiMetricModel");
const KpiDailyReportModel = require("../src/models/KpiDailyReportModel");
const KpiPeriodTargetModel = require("../src/models/KpiPeriodTargetModel");
const { KPI_GROUP, KPI_SOURCE } = require("../src/constants");
const { dayKey, monthKey } = require("../src/helpers/kpiPeriod");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.headers["x-test-account"];
    req.account = raw ? JSON.parse(raw) : null;
    next();
  });
  const kpiDailyReportRouter = require("../src/routes/kpiDailyReport");
  app.use("/kpi/daily-reports", kpiDailyReportRouter);
  return app;
}

let mongod;
let app;

beforeAll(async () => {
  // update/submit dùng session.startTransaction() — cần replica set dù chỉ 1 node.
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  app = buildApp();
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    DepartmentModel.deleteMany({}),
    UserDepartmentPositionModel.deleteMany({}),
    PositionModel.deleteMany({}),
    KpiMetricModel.deleteMany({}),
    KpiDailyReportModel.deleteMany({}),
    KpiPeriodTargetModel.deleteMany({})
  ]);
});

const REPORT_DATE = "2026-07-20"; // thứ Hai

async function setupSale() {
  const account = await AccountModel.create({
    username: `sale_${Date.now()}_${Math.random()}`,
    password: "hashed",
    role: "admin" // admin bypass requirePermission — chỉ để test nghiệp vụ, không test phân quyền ở đây
  });
  const userInfo = await UserInfoModel.create({
    full_name: "Sale Test",
    cccd: `${Date.now()}`.slice(0, 12).padEnd(12, "0"),
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `NV${Date.now()}${Math.floor(Math.random() * 100000)}`,
    employment_type: "fulltime"
  });
  const ttkd = await DepartmentModel.create({
    department_name: "TTKD Test",
    department_code: `TTKD-TEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    type: "branch"
  });
  const position = await PositionModel.create({ position_name: "Sale" });
  await UserDepartmentPositionModel.create({
    user: userInfo._id,
    department: ttkd._id,
    position: position._id
  });

  const asSale = { "x-test-account": JSON.stringify({ _id: account._id, role: "admin" }) };
  return { account, userInfo, ttkd, asSale };
}

async function createInputMetrics() {
  await KpiMetricModel.create([
    { code: "telesale_call", name: "Cuộc gọi telesale", group: KPI_GROUP.INPUT, source: KPI_SOURCE.MANUAL },
    { code: "sms_sent", name: "SMS đã gửi", group: KPI_GROUP.INPUT, source: KPI_SOURCE.MANUAL },
    {
      code: "investment_revenue",
      name: "Doanh số đầu tư",
      group: KPI_GROUP.OUTPUT,
      source: KPI_SOURCE.AUTO,
      auto_source: "investment_revenue"
    }
  ]);
}

async function getPeriodTarget(scopeType, scopeId, metricCode, periodType, periodKey) {
  return KpiPeriodTargetModel.findOne({
    scope_type: scopeType,
    scope_id: scopeId,
    metric_code: metricCode,
    period_type: periodType,
    period_key: periodKey
  }).lean();
}

// =====================================================================
describe("POST /kpi/daily-reports — tạo báo cáo (draft)", () => {
  test("tạo draft thành công", async () => {
    const { asSale } = await setupSale();
    await createInputMetrics();

    const res = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("draft");
  });

  test("metric thuộc group=output bị từ chối", async () => {
    const { asSale } = await setupSale();
    await createInputMetrics();

    const res = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "investment_revenue", value: 5 }] });

    expect(res.status).toBe(400);
  });

  test("gọi create lần 2 cùng ngày khi còn draft → update thay vì lỗi trùng", async () => {
    const { asSale } = await setupSale();
    await createInputMetrics();

    await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });

    const res = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 9 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.items[0].value).toBe(9);
    expect(await KpiDailyReportModel.countDocuments({})).toBe(1);
  });

  test("chưa đăng nhập → 401", async () => {
    const res = await request(app)
      .post("/kpi/daily-reports")
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });
    expect(res.status).toBe(401);
  });

  test("account không có quyền kpi.report.submit → 403", async () => {
    await createInputMetrics();
    const account = await AccountModel.create({ username: "plain_user", password: "x", role: "user" });
    const asPlain = { "x-test-account": JSON.stringify({ _id: account._id, role: "user" }) };

    const res = await request(app)
      .post("/kpi/daily-reports")
      .set(asPlain)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });
    expect(res.status).toBe(403);
  });
});

// =====================================================================
describe("POST /kpi/daily-reports/:id/submit — submit và đẩy actual", () => {
  test("submit đẩy actual vào day+month, cả sale và ttkd", async () => {
    const { userInfo, ttkd, asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({
        date: REPORT_DATE,
        items: [
          { metric_code: "telesale_call", value: 5 },
          { metric_code: "sms_sent", value: 10 }
        ]
      });

    const submit = await request(app)
      .post(`/kpi/daily-reports/${create.body.data._id}/submit`)
      .set(asSale);

    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");

    const dKey = dayKey(new Date(REPORT_DATE));
    const mKey = monthKey(2026, 7);

    const saleDay = await getPeriodTarget("sale", userInfo._id, "telesale_call", "day", dKey);
    const saleMonth = await getPeriodTarget("sale", userInfo._id, "telesale_call", "month", mKey);
    const ttkdDay = await getPeriodTarget("ttkd", ttkd._id, "telesale_call", "day", dKey);
    const ttkdMonth = await getPeriodTarget("ttkd", ttkd._id, "telesale_call", "month", mKey);

    expect(saleDay.actual).toBe(5);
    expect(saleMonth.actual).toBe(5);
    expect(ttkdDay.actual).toBe(5);
    expect(ttkdMonth.actual).toBe(5);

    const smsDay = await getPeriodTarget("sale", userInfo._id, "sms_sent", "day", dKey);
    expect(smsDay.actual).toBe(10);
  });

  test("submit 2 lần → lần 2 lỗi 409", async () => {
    const { asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });
    await request(app).post(`/kpi/daily-reports/${create.body.data._id}/submit`).set(asSale);

    const res = await request(app)
      .post(`/kpi/daily-reports/${create.body.data._id}/submit`)
      .set(asSale);
    expect(res.status).toBe(409);
  });
});

// =====================================================================
describe("PATCH /kpi/daily-reports/:id — sửa sau khi đã submit", () => {
  test("tăng value → actual cộng thêm đúng phần chênh lệch (không nhân đôi)", async () => {
    const { userInfo, asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });
    await request(app).post(`/kpi/daily-reports/${create.body.data._id}/submit`).set(asSale);

    const update = await request(app)
      .patch(`/kpi/daily-reports/${create.body.data._id}`)
      .set(asSale)
      .send({ items: [{ metric_code: "telesale_call", value: 8 }] });

    expect(update.status).toBe(200);

    const dKey = dayKey(new Date(REPORT_DATE));
    const saleDay = await getPeriodTarget("sale", userInfo._id, "telesale_call", "day", dKey);
    expect(saleDay.actual).toBe(8);
  });

  test("bỏ 1 metric khỏi items → actual của metric đó bị trừ về đúng phần chênh lệch (0)", async () => {
    const { userInfo, asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({
        date: REPORT_DATE,
        items: [
          { metric_code: "telesale_call", value: 5 },
          { metric_code: "sms_sent", value: 10 }
        ]
      });
    await request(app).post(`/kpi/daily-reports/${create.body.data._id}/submit`).set(asSale);

    const update = await request(app)
      .patch(`/kpi/daily-reports/${create.body.data._id}`)
      .set(asSale)
      .send({ items: [{ metric_code: "telesale_call", value: 5 }] });

    expect(update.status).toBe(200);

    const dKey = dayKey(new Date(REPORT_DATE));
    const callDay = await getPeriodTarget("sale", userInfo._id, "telesale_call", "day", dKey);
    const smsDay = await getPeriodTarget("sale", userInfo._id, "sms_sent", "day", dKey);
    expect(callDay.actual).toBe(5); // không đổi (delta=0)
    expect(smsDay.actual).toBe(0); // bị trừ hết phần đã cộng trước đó (10 -> 0)
  });

  test("thay giá trị 1 metric trong bộ nhiều metric, metric còn lại giữ nguyên actual", async () => {
    const { userInfo, asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({
        date: REPORT_DATE,
        items: [
          { metric_code: "telesale_call", value: 5 },
          { metric_code: "sms_sent", value: 10 }
        ]
      });
    await request(app).post(`/kpi/daily-reports/${create.body.data._id}/submit`).set(asSale);

    await request(app)
      .patch(`/kpi/daily-reports/${create.body.data._id}`)
      .set(asSale)
      .send({
        items: [
          { metric_code: "telesale_call", value: 7 },
          { metric_code: "sms_sent", value: 10 }
        ]
      });

    const dKey = dayKey(new Date(REPORT_DATE));
    const callDay = await getPeriodTarget("sale", userInfo._id, "telesale_call", "day", dKey);
    const smsDay = await getPeriodTarget("sale", userInfo._id, "sms_sent", "day", dKey);
    expect(callDay.actual).toBe(7);
    expect(smsDay.actual).toBe(10);
  });

  test("kỳ ngày đã is_closed → actual ngày không đổi, actual tháng vẫn cập nhật", async () => {
    const { userInfo, asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });
    await request(app).post(`/kpi/daily-reports/${create.body.data._id}/submit`).set(asSale);

    const dKey = dayKey(new Date(REPORT_DATE));
    const mKey = monthKey(2026, 7);
    await KpiPeriodTargetModel.updateOne(
      { scope_type: "sale", scope_id: userInfo._id, metric_code: "telesale_call", period_type: "day", period_key: dKey },
      { $set: { is_closed: true } }
    );

    await request(app)
      .patch(`/kpi/daily-reports/${create.body.data._id}`)
      .set(asSale)
      .send({ items: [{ metric_code: "telesale_call", value: 20 }] });

    const dayRow = await getPeriodTarget("sale", userInfo._id, "telesale_call", "day", dKey);
    const monthRow = await getPeriodTarget("sale", userInfo._id, "telesale_call", "month", mKey);
    expect(dayRow.actual).toBe(5); // không đổi vì đã closed
    expect(monthRow.actual).toBe(20); // tháng vẫn cập nhật bình thường
  });
});

// =====================================================================
describe("DELETE /kpi/daily-reports/:id", () => {
  test("xóa được khi còn draft", async () => {
    const { asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });

    const del = await request(app).delete(`/kpi/daily-reports/${create.body.data._id}`).set(asSale);
    expect(del.status).toBe(200);
  });

  test("không xóa được khi đã submitted", async () => {
    const { asSale } = await setupSale();
    await createInputMetrics();

    const create = await request(app)
      .post("/kpi/daily-reports")
      .set(asSale)
      .send({ date: REPORT_DATE, items: [{ metric_code: "telesale_call", value: 5 }] });
    await request(app).post(`/kpi/daily-reports/${create.body.data._id}/submit`).set(asSale);

    const del = await request(app).delete(`/kpi/daily-reports/${create.body.data._id}`).set(asSale);
    expect(del.status).toBe(409);
  });
});
