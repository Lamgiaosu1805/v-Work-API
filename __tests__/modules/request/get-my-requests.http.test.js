const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const express = require("express");

jest.mock("../../../src/middlewares/authMiddleware", () => ({
  authenticate: (req, res, next) => {
    if (!req.headers["x-test-account"]) return res.status(401).json({ message: "Chưa đăng nhập" });
    req.account = { _id: req.headers["x-test-account"] };
    next();
  }
}));

const UserInfoModel = require("../../../src/models/UserInfoModel");
const AccountModel = require("../../../src/models/AccountModel");
const { LeaveRequest, RemoteRequest } = require("../../../src/models/RequestModel");
const requestRoutes = require("../../../src/modules/request/interface/request.routes");
const { errorHandlerMiddleware } = require("../../../src/core/http/error-handler.middleware");

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  app = express();
  app.use(express.json());
  app.use("/requests", requestRoutes);
  app.use(errorHandlerMiddleware);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await UserInfoModel.deleteMany({});
  await AccountModel.deleteMany({});
  await LeaveRequest.deleteMany({});
});

async function createUserInfo(n) {
  const account = await AccountModel.create({ username: `acc${n}`, password: "x", role: "user" });
  const userInfo = await UserInfoModel.create({
    full_name: `NV ${n}`,
    cccd: `${n}`.padStart(12, "0"),
    phone_number: `090${n}`.padEnd(10, "0"),
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `NV${n}`,
    employment_type: "fulltime"
  });
  return { account, userInfo };
}

function leaveRequestPayload(userId, overrides = {}) {
  return {
    user_id: userId,
    reason: "test",
    from_date: new Date("2026-01-05"),
    from_period: "morning",
    to_date: new Date("2026-01-05"),
    to_period: "afternoon",
    total_days: 1,
    leave_type: "paid",
    ...overrides
  };
}

describe("GET /requests/my", () => {
  it("200: chỉ trả về đơn của chính user đó, kèm pagination đúng", async () => {
    const { userInfo: me } = await createUserInfo(1);
    const { userInfo: other } = await createUserInfo(2);

    await LeaveRequest.create(leaveRequestPayload(me._id));
    await LeaveRequest.create(leaveRequestPayload(me._id));
    await LeaveRequest.create(leaveRequestPayload(other._id));

    const res = await request(app).get("/requests/my").set("x-test-account", String(me.id_account));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("OK");
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ total: 2, page: 1, limit: 20, total_pages: 1 });
  });

  it("200: lọc theo request_type hợp lệ", async () => {
    const { userInfo: me } = await createUserInfo(1);
    await LeaveRequest.create(leaveRequestPayload(me._id));
    await RemoteRequest.create({
      user_id: me._id,
      reason: "wfh",
      from_date: new Date("2026-01-06"),
      to_date: new Date("2026-01-06"),
      total_days: 1
    });

    const res = await request(app)
      .get("/requests/my?request_type=remote")
      .set("x-test-account", String(me.id_account));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].request_type).toBe("remote");
  });

  it("400: request_type không hợp lệ throw lỗi rõ ràng, KHÁC hành vi gốc (đã sửa — xem plan)", async () => {
    const { userInfo: me } = await createUserInfo(1);
    await LeaveRequest.create(leaveRequestPayload(me._id));

    const res = await request(app)
      .get("/requests/my?request_type=not_a_real_type")
      .set("x-test-account", String(me.id_account));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Loại đơn không hợp lệ/);
  });

  it("200: populate reviewed_by trả full_name", async () => {
    const { userInfo: me } = await createUserInfo(1);
    const { userInfo: reviewer } = await createUserInfo(2);
    await LeaveRequest.create(
      leaveRequestPayload(me._id, {
        status: "approved",
        reviewed_by: reviewer._id,
        reviewed_at: new Date()
      })
    );

    const res = await request(app).get("/requests/my").set("x-test-account", String(me.id_account));

    expect(res.body.data[0].reviewed_by.full_name).toBe("NV 2");
  });

  it("404: không tìm thấy user_info cho account", async () => {
    const res = await request(app)
      .get("/requests/my")
      .set("x-test-account", String(new mongoose.Types.ObjectId()));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Không tìm thấy thông tin nhân viên" });
  });

  it("400: from không parse được — KHÔNG còn là 500 CastError lộ tên field/model (đã sửa, xem plan)", async () => {
    const { userInfo: me } = await createUserInfo(1);

    const res = await request(app)
      .get("/requests/my?from=invalid-date")
      .set("x-test-account", String(me.id_account));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/from.*không hợp lệ/);
  });

  describe("pagination — đã sửa lỗ hổng không validate page/limit (khác code gốc, xem plan)", () => {
    it("limit=abc (NaN) không còn trả về không giới hạn — fallback về default 20", async () => {
      const { userInfo: me } = await createUserInfo(1);
      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await LeaveRequest.create(leaveRequestPayload(me._id));
      }

      const res = await request(app)
        .get("/requests/my?limit=abc")
        .set("x-test-account", String(me.id_account));

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.data).toHaveLength(3);
    });

    it("limit=99999 bị clamp về 100, không query không giới hạn", async () => {
      const { userInfo: me } = await createUserInfo(1);
      const res = await request(app)
        .get("/requests/my?limit=99999")
        .set("x-test-account", String(me.id_account));

      expect(res.body.pagination.limit).toBe(100);
    });

    it("page=abc (NaN) fallback về page 1, không throw", async () => {
      const { userInfo: me } = await createUserInfo(1);
      const res = await request(app)
        .get("/requests/my?page=abc")
        .set("x-test-account", String(me.id_account));

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
    });
  });
});
