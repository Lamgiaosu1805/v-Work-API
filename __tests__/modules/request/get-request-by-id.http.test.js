const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const express = require("express");

jest.mock("../../../src/middlewares/authMiddleware", () => ({
  authenticate: (req, res, next) => {
    if (!req.headers["x-test-account"]) return res.status(401).json({ message: "Chưa đăng nhập" });
    req.account = { _id: req.headers["x-test-account"], role: "user" };
    next();
  }
}));

jest.mock("../../../src/helpers/rbac", () => ({ can: jest.fn() }));
jest.mock("../../../src/modules/request/domain/approval-chain", () => ({
  getApprovalChain: jest.fn().mockResolvedValue([]),
  getManagedUserIds: jest.fn()
}));

const { can } = require("../../../src/helpers/rbac");
const UserInfoModel = require("../../../src/models/UserInfoModel");
const AccountModel = require("../../../src/models/AccountModel");
const { LeaveRequest } = require("../../../src/models/RequestModel");
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
  jest.clearAllMocks();
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

describe("GET /requests/:id", () => {
  it("400: id không hợp lệ", async () => {
    const { account } = await createUserInfo(1);
    const res = await request(app)
      .get("/requests/not-an-object-id")
      .set("x-test-account", String(account._id));
    expect(res.status).toBe(400);
  });

  it("404: đơn không tồn tại", async () => {
    const { account } = await createUserInfo(1);
    can.mockResolvedValue(false);
    const res = await request(app)
      .get(`/requests/${new mongoose.Types.ObjectId()}`)
      .set("x-test-account", String(account._id));
    expect(res.status).toBe(404);
  });

  it("200: owner xem được đơn của chính mình", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const doc = await LeaveRequest.create({
      user_id: userInfo._id,
      reason: "test",
      from_date: new Date("2026-01-05"),
      from_period: "morning",
      to_date: new Date("2026-01-05"),
      to_period: "afternoon",
      total_days: 1,
      leave_type: "paid",
      status: "cancelled"
    });
    can.mockResolvedValue(false);

    const res = await request(app)
      .get(`/requests/${doc._id}`)
      .set("x-test-account", String(account._id));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("OK");
    expect(String(res.body.data.user_id._id)).toBe(String(userInfo._id));
  });

  it("403: không có quyền xem đơn của người khác", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const doc = await LeaveRequest.create({
      user_id: owner._id,
      reason: "test",
      from_date: new Date("2026-01-05"),
      from_period: "morning",
      to_date: new Date("2026-01-05"),
      to_period: "afternoon",
      total_days: 1,
      leave_type: "paid",
      status: "cancelled"
    });
    can.mockResolvedValue(false);

    const res = await request(app)
      .get(`/requests/${doc._id}`)
      .set("x-test-account", String(account._id));
    expect(res.status).toBe(403);
  });
});
