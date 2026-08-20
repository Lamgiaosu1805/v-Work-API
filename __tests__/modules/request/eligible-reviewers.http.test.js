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
const requestRoutes = require("../../../src/modules/request/interface/request.routes");
const { errorHandlerMiddleware } = require("../../../src/core/http/error-handler.middleware");
const { grantRequestPermission } = require("../../helpers/grantRequestPermission");
const EmployeePermissionProfileModel =
  require("../../../src/models/EmployeePermissionProfileModel").default;

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
  await EmployeePermissionProfileModel.deleteMany({});
});

async function createUserInfo(n) {
  const account = await AccountModel.create({
    username: `acc${n}`,
    password: "x",
    role: "user"
  });
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
  await grantRequestPermission(userInfo._id);
  return userInfo;
}

describe("GET /requests/eligible-reviewers — full HTTP pipeline (route -> asyncHandler -> service -> global error middleware)", () => {
  it("200: trả về data: [] khi chain rỗng (không có ai đủ quyền duyệt được seed)", async () => {
    const userInfo = await createUserInfo(1);

    const res = await request(app)
      .get("/requests/eligible-reviewers")
      .set("x-test-account", String(userInfo.id_account));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "OK", data: [] });
  });

  it("404: không tìm thấy user_info — lỗi từ application service tự propagate qua asyncHandler tới global error middleware, đúng format { message }", async () => {
    const res = await request(app)
      .get("/requests/eligible-reviewers")
      .set("x-test-account", String(new mongoose.Types.ObjectId()));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Không tìm thấy thông tin nhân viên" });
  });

  it("401: chưa đăng nhập vẫn được middleware authenticate chặn như cũ, không đổi hành vi", async () => {
    const res = await request(app).get("/requests/eligible-reviewers");
    expect(res.status).toBe(401);
  });
});
