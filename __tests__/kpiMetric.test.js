const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const express = require("express");

// redis tự redirect sang mock qua moduleNameMapper trong jest.config.js

// Mock authMiddleware: authenticate đọc req.account từ header x-test-account (đã set bởi stub app)
jest.mock("../src/middlewares/authMiddleware", () => ({
  authenticate: (req, res, next) => {
    if (!req.account) return res.status(401).json({ message: "Chưa đăng nhập" });
    next();
  },
  isAdmin: (req, res, next) => {
    if (!req.account || req.account.role !== "admin")
      return res.status(403).json({ message: "Chỉ admin" });
    next();
  },
  isManager: (req, res, next) => {
    if (!req.account || !["admin", "manager"].includes(req.account.role))
      return res.status(403).json({ message: "Cần manager trở lên" });
    next();
  },
  hasModuleAccess: () => (req, res, next) => next(),
  canManage: () => (req, res, next) => next(),
  hasCrmAccess: (req, res, next) => next()
}));

const KpiMetricModel = require("../src/models/KpiMetricModel");
const { KPI_GROUP, KPI_SOURCE, KPI_AUTO_SOURCE } = require("../src/constants");

// App tối giản — inject req.account từ header trước khi route chạy
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.headers["x-test-account"];
    req.account = raw ? JSON.parse(raw) : null;
    next();
  });
  // Require sau mock để route nhận middleware đã mock
  const kpiMetricRouter = require("../src/routes/kpiMetric");
  app.use("/kpi/metrics", kpiMetricRouter);
  return app;
}

let mongod;
let app;

const adminId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();

const asAdmin = { "x-test-account": JSON.stringify({ _id: adminId, role: "admin" }) };
const asUser  = { "x-test-account": JSON.stringify({ _id: userId,  role: "user", module_access: [] }) };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await KpiMetricModel.deleteMany({});
});

// ---------- fixtures ----------
const VALID_AUTO = {
  code: "investment_revenue",
  name: "Doanh số đầu tư",
  group: KPI_GROUP.OUTPUT,
  source: KPI_SOURCE.AUTO,
  auto_source: KPI_AUTO_SOURCE.INVESTMENT_REVENUE,
  unit: "VND",
  order: 1
};

const VALID_MANUAL = {
  code: "telesale_call",
  name: "Cuộc gọi telesale",
  group: KPI_GROUP.INPUT,
  source: KPI_SOURCE.MANUAL,
  unit: "cuộc gọi",
  order: 2
};

async function createMetric(body = VALID_AUTO) {
  return request(app).post("/kpi/metrics").set(asAdmin).send(body);
}

// =====================================================================
describe("POST /kpi/metrics — tạo metric", () => {
  test("tạo metric auto thành công", async () => {
    const res = await createMetric(VALID_AUTO);
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe("investment_revenue");
    expect(res.body.data.auto_source).toBe(KPI_AUTO_SOURCE.INVESTMENT_REVENUE);
  });

  test("tạo metric manual thành công, auto_source bị ép về null", async () => {
    // truyền auto_source nhưng source=manual → bị ép null
    const res = await createMetric({ ...VALID_MANUAL, auto_source: KPI_AUTO_SOURCE.CIF });
    expect(res.status).toBe(201);
    expect(res.body.data.auto_source).toBeNull();
  });

  test("thiếu trường bắt buộc → 400", async () => {
    const res = await createMetric({ code: "x", name: "X" }); // thiếu group, source
    expect(res.status).toBe(400);
  });

  test("source=auto mà thiếu auto_source → 400", async () => {
    const { auto_source, ...body } = VALID_AUTO;
    const res = await createMetric(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/auto_source/);
  });

  test("source=auto với auto_source không nằm trong enum → 400", async () => {
    const res = await createMetric({ ...VALID_AUTO, auto_source: "invalid_source" });
    expect(res.status).toBe(400);
  });

  test("trùng code → 409", async () => {
    await createMetric(VALID_AUTO);
    const res = await createMetric(VALID_AUTO);
    expect(res.status).toBe(409);
  });

  test("user thường không có quyền tạo → 403", async () => {
    const res = await request(app).post("/kpi/metrics").set(asUser).send(VALID_AUTO);
    expect(res.status).toBe(403);
  });

  test("chưa đăng nhập → 401", async () => {
    const res = await request(app).post("/kpi/metrics").send(VALID_AUTO);
    expect(res.status).toBe(401);
  });

  test("is_active mặc định là true", async () => {
    const res = await createMetric(VALID_MANUAL);
    expect(res.body.data.is_active).toBe(true);
  });
});

// =====================================================================
describe("GET /kpi/metrics — danh sách", () => {
  beforeEach(async () => {
    await KpiMetricModel.create([
      { ...VALID_AUTO },
      { ...VALID_MANUAL },
      {
        code: "cif_new", name: "CIF mới",
        group: KPI_GROUP.OUTPUT, source: KPI_SOURCE.AUTO,
        auto_source: KPI_AUTO_SOURCE.CIF, is_active: false, order: 3
      }
    ]);
  });

  test("user thường đọc được danh sách", async () => {
    const res = await request(app).get("/kpi/metrics").set(asUser);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
  });

  test("lọc theo group=output", async () => {
    const res = await request(app).get("/kpi/metrics?group=output").set(asUser);
    expect(res.body.data.every((m) => m.group === "output")).toBe(true);
    expect(res.body.data.length).toBe(2);
  });

  test("lọc theo source=manual", async () => {
    const res = await request(app).get("/kpi/metrics?source=manual").set(asUser);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].code).toBe("telesale_call");
  });

  test("lọc is_active=false chỉ trả inactive", async () => {
    const res = await request(app).get("/kpi/metrics?is_active=false").set(asUser);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].code).toBe("cif_new");
  });

  test("sắp xếp theo order tăng dần", async () => {
    const res = await request(app).get("/kpi/metrics").set(asUser);
    const orders = res.body.data.map((m) => m.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  test("chưa đăng nhập → 401", async () => {
    const res = await request(app).get("/kpi/metrics");
    expect(res.status).toBe(401);
  });
});

// =====================================================================
describe("GET /kpi/metrics/:id", () => {
  test("lấy theo id thành công", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app).get(`/kpi/metrics/${body.data._id}`).set(asUser);
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe("investment_revenue");
  });

  test("id không tồn tại → 404", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/kpi/metrics/${fakeId}`).set(asUser);
    expect(res.status).toBe(404);
  });

  test("id không hợp lệ → 400", async () => {
    const res = await request(app).get("/kpi/metrics/not-an-id").set(asUser);
    expect(res.status).toBe(400);
  });
});

// =====================================================================
describe("PATCH /kpi/metrics/:id — cập nhật", () => {
  test("sửa name, unit, order thành công", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app)
      .patch(`/kpi/metrics/${body.data._id}`)
      .set(asAdmin)
      .send({ name: "Doanh số mới", unit: "tỷ VND", order: 99 });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Doanh số mới");
    expect(res.body.data.unit).toBe("tỷ VND");
    expect(res.body.data.order).toBe(99);
    expect(res.body.data.code).toBe("investment_revenue"); // code không đổi
  });

  test("KHÔNG được sửa code → 400", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app)
      .patch(`/kpi/metrics/${body.data._id}`)
      .set(asAdmin)
      .send({ code: "changed_code" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/code/);
  });

  test("gửi đúng code cũ không bị báo lỗi", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app)
      .patch(`/kpi/metrics/${body.data._id}`)
      .set(asAdmin)
      .send({ code: "investment_revenue", name: "Tên mới" });
    expect(res.status).toBe(200);
  });

  test("đổi source=manual → auto_source tự ép về null", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app)
      .patch(`/kpi/metrics/${body.data._id}`)
      .set(asAdmin)
      .send({ source: KPI_SOURCE.MANUAL });
    expect(res.status).toBe(200);
    expect(res.body.data.auto_source).toBeNull();
  });

  test("đổi source=auto mà thiếu auto_source → 400", async () => {
    const { body } = await createMetric(VALID_MANUAL);
    const res = await request(app)
      .patch(`/kpi/metrics/${body.data._id}`)
      .set(asAdmin)
      .send({ source: KPI_SOURCE.AUTO }); // thiếu auto_source
    expect(res.status).toBe(400);
  });

  test("bật/tắt is_active", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app)
      .patch(`/kpi/metrics/${body.data._id}`)
      .set(asAdmin)
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  test("user thường không có quyền sửa → 403", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app)
      .patch(`/kpi/metrics/${body.data._id}`)
      .set(asUser)
      .send({ name: "X" });
    expect(res.status).toBe(403);
  });

  test("id không tồn tại → 404", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).patch(`/kpi/metrics/${fakeId}`).set(asAdmin).send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

// =====================================================================
describe("DELETE /kpi/metrics/:id — soft delete", () => {
  test("xóa thành công, không còn xuất hiện trong list", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const del = await request(app).delete(`/kpi/metrics/${body.data._id}`).set(asAdmin);
    expect(del.status).toBe(200);

    const list = await request(app).get("/kpi/metrics").set(asUser);
    expect(list.body.data.find((m) => m.code === "investment_revenue")).toBeUndefined();
  });

  test("soft delete: record vẫn còn trong DB với isDeleted=true", async () => {
    const { body } = await createMetric(VALID_AUTO);
    await request(app).delete(`/kpi/metrics/${body.data._id}`).set(asAdmin);
    const raw = await KpiMetricModel.findById(body.data._id).lean();
    expect(raw).not.toBeNull();
    expect(raw.isDeleted).toBe(true);
  });

  test("xóa 2 lần → lần 2 là 404 (đã soft delete)", async () => {
    const { body } = await createMetric(VALID_AUTO);
    await request(app).delete(`/kpi/metrics/${body.data._id}`).set(asAdmin);
    const res = await request(app).delete(`/kpi/metrics/${body.data._id}`).set(asAdmin);
    expect(res.status).toBe(404);
  });

  test("user thường không có quyền xóa → 403", async () => {
    const { body } = await createMetric(VALID_AUTO);
    const res = await request(app).delete(`/kpi/metrics/${body.data._id}`).set(asUser);
    expect(res.status).toBe(403);
  });
});
