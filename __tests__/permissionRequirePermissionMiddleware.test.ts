import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import express, { Request, Response } from "express";
import redisMock from "./mocks/redis";

jest.mock("../src/middlewares/authMiddleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-account"]) {
      return res.status(401).json({ message: "Chưa đăng nhập" });
    }
    req.account = { _id: req.headers["x-test-account"] };
    return next();
  }
}));

// eslint-disable-next-line import/first
import { authenticate } from "../src/middlewares/authMiddleware";
// eslint-disable-next-line import/first
import { requirePermission } from "../src/core/authorization/require-permission.middleware";
// eslint-disable-next-line import/first
import { errorHandlerMiddleware } from "../src/core/http/error-handler.middleware";
// eslint-disable-next-line import/first
import UserInfoModel from "../src/models/UserInfoModel";
// eslint-disable-next-line import/first
import AccountModel from "../src/models/AccountModel";
// eslint-disable-next-line import/first
import PermissionRoleModel from "../src/models/PermissionRoleModel";
// eslint-disable-next-line import/first
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
// eslint-disable-next-line import/first
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
// eslint-disable-next-line import/first
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";

let mongod: MongoMemoryServer;
let app: express.Express;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  app = express();
  app.use(express.json());
  app.get(
    "/protected",
    authenticate,
    requirePermission("employee.view", "Employee"),
    (req: Request, res: Response) => {
      res.status(200).json({ message: "OK", hasAbility: Boolean(req.permissionAbility) });
    }
  );
  app.use(errorHandlerMiddleware);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  redisMock.__store.clear();
  await Promise.all([
    UserInfoModel.deleteMany({}),
    AccountModel.deleteMany({}),
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({})
  ]);
});

async function createEmployeeWithGrant() {
  const account = await AccountModel.create({
    username: `u_${Date.now()}_${Math.random()}`,
    password: "x",
    role: "user"
  });
  const userInfo = await UserInfoModel.create({
    full_name: "NV Test",
    cccd: String(Date.now()),
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `MV${Date.now()}${Math.floor(Math.random() * 1000)}`,
    employment_type: "fulltime"
  });

  await PermissionCatalogModel.create({
    code: "employee.view",
    module: "hrm",
    name: "Xem danh sách nhân viên",
    entity: "Employee",
    actionKind: "READ",
    supportsFieldScope: false,
    validDataScopePolicies: ["ALL_COMPANY"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "ALL_COMPANY",
    entity: "Employee",
    label: "Toàn công ty",
    conditionTree: null
  });
  const role = await PermissionRoleModel.create({
    name: "Nhân viên",
    code: "STAFF",
    grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "ALL_COMPANY" }]
  });
  await EmployeePermissionProfileModel.create({
    employeeId: userInfo._id,
    roleIds: [role._id],
    overrides: []
  });

  return { account, userInfo };
}

describe("requirePermission middleware", () => {
  test("chưa đăng nhập -> 401 (từ authenticate)", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
  });

  test("có quyền -> 200, req.permissionAbility được gắn cho route sau dùng", async () => {
    const { account } = await createEmployeeWithGrant();
    const res = await request(app).get("/protected").set("x-test-account", String(account._id));

    expect(res.status).toBe(200);
    expect(res.body.hasAbility).toBe(true);
  });

  test("không có role/permission nào -> 403", async () => {
    const account = await AccountModel.create({
      username: `u2_${Date.now()}`,
      password: "x",
      role: "user"
    });
    await UserInfoModel.create({
      full_name: "NV Khong Quyen",
      cccd: String(Date.now() + 1),
      phone_number: "0900000001",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: account._id,
      ma_nv: `MV2${Date.now()}${Math.floor(Math.random() * 1000)}`,
      employment_type: "fulltime"
    });

    const res = await request(app).get("/protected").set("x-test-account", String(account._id));
    expect(res.status).toBe(403);
  });

  test("cache hoạt động -- xóa role thẳng trong DB sau request đầu, request thứ 2 vẫn pass vì đọc cache", async () => {
    const { account } = await createEmployeeWithGrant();

    const first = await request(app).get("/protected").set("x-test-account", String(account._id));
    expect(first.status).toBe(200);

    await PermissionRoleModel.deleteMany({});

    const second = await request(app).get("/protected").set("x-test-account", String(account._id));
    expect(second.status).toBe(200);
  });
});
