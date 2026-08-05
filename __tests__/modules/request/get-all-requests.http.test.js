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
jest.mock("../../../src/helpers/approvalChain", () => ({ getManagedUserIds: jest.fn() }));

const { can } = require("../../../src/helpers/rbac");
const { getManagedUserIds } = require("../../../src/helpers/approvalChain");
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

async function createUserInfo(n, fullName) {
  const account = await AccountModel.create({ username: `acc${n}`, password: "x", role: "user" });
  const userInfo = await UserInfoModel.create({
    full_name: fullName ?? `NV ${n}`,
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

describe("GET /requests (getAll)", () => {
  it("hasViewAll=true: thấy đơn của MỌI người, NHƯNG loại trừ đơn của chính mình", async () => {
    const { account: me, userInfo: myInfo } = await createUserInfo(1);
    const { userInfo: otherInfo } = await createUserInfo(2);
    can.mockResolvedValue(true);

    await LeaveRequest.create(leaveRequestPayload(myInfo._id));
    await LeaveRequest.create(leaveRequestPayload(otherInfo._id));

    const res = await request(app).get("/requests").set("x-test-account", String(me._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(res.body.data[0].user_id._id)).toBe(String(otherInfo._id));
  });

  it("hasViewAll=false, hasReview=true: chỉ thấy đơn của user trong scope quản lý (getManagedUserIds)", async () => {
    const { account: me, userInfo: myInfo } = await createUserInfo(1);
    const { userInfo: managedInfo } = await createUserInfo(2);
    const { userInfo: outOfScopeInfo } = await createUserInfo(3);
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    getManagedUserIds.mockResolvedValue([managedInfo._id]);

    await LeaveRequest.create(leaveRequestPayload(myInfo._id));
    await LeaveRequest.create(leaveRequestPayload(managedInfo._id));
    await LeaveRequest.create(leaveRequestPayload(outOfScopeInfo._id));

    const res = await request(app).get("/requests").set("x-test-account", String(me._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(res.body.data[0].user_id._id)).toBe(String(managedInfo._id));
  });

  it("hasViewAll=false, hasReview=false: 403", async () => {
    const { account: me } = await createUserInfo(1);
    can.mockResolvedValue(false);

    const res = await request(app).get("/requests").set("x-test-account", String(me._id));

    expect(res.status).toBe(403);
  });

  it("hasViewAll=false, hasReview=true, không có user_info: 404 message nhất quán với 1.6/1.7", async () => {
    const account = await AccountModel.create({ username: "no-info", password: "x", role: "user" });
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const res = await request(app).get("/requests").set("x-test-account", String(account._id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Không tìm thấy thông tin nhân viên" });
  });

  it("search chứa ký tự regex đặc biệt KHÔNG crash (bug thật đã sửa, xem plan)", async () => {
    const { account: me, userInfo: myInfo } = await createUserInfo(1);
    const { userInfo: targetInfo } = await createUserInfo(2, "Nguyen Van A (CN2)");
    can.mockResolvedValue(true);

    await LeaveRequest.create(leaveRequestPayload(myInfo._id));
    await LeaveRequest.create(leaveRequestPayload(targetInfo._id));

    const res = await request(app)
      .get("/requests?search=(CN2)")
      .set("x-test-account", String(me._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(res.body.data[0].user_id._id)).toBe(String(targetInfo._id));
  });

  it("request_type không hợp lệ vẫn throw 400 (reuse applyRequestTypeFilter đúng)", async () => {
    const { account: me } = await createUserInfo(1);
    can.mockResolvedValue(true);

    const res = await request(app)
      .get("/requests?request_type=not_a_real_type")
      .set("x-test-account", String(me._id));

    expect(res.status).toBe(400);
  });
});
