process.env.UPLOAD_DIR_PUBLIC_DEV = process.env.UPLOAD_DIR_PUBLIC_DEV || "./uploads";
process.env.UPLOAD_DIR_DEV = process.env.UPLOAD_DIR_DEV || "./uploads";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const UserController = require("../src/controllers/UserController");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const PermissionModel = require("../src/models/PermissionModel");
const RoleModel = require("../src/models/RoleModel");
const RolePermissionModel = require("../src/models/RolePermissionModel");
const UserRoleModel = require("../src/models/UserRoleModel");
const { PERMISSION } = require("../src/constants");
const redisMock = require("./mocks/redis");

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    PermissionModel.deleteMany({}),
    RoleModel.deleteMany({}),
    RolePermissionModel.deleteMany({}),
    UserRoleModel.deleteMany({})
  ]);
  redisMock.__store.clear();
});

let seq = 0;
const nextSeq = () => {
  seq += 1;
  return seq;
};

async function createAccount(role = "user") {
  const n = nextSeq();
  return AccountModel.create({ username: `user_${n}`, password: "hashed", role });
}

async function grantPermission(accountId, permissionCode) {
  const n = nextSeq();
  const permission = await PermissionModel.findOneAndUpdate(
    { code: permissionCode },
    { $setOnInsert: { code: permissionCode, group: permissionCode.split(".")[0] } },
    { upsert: true, new: true }
  );
  const role = await RoleModel.create({ code: `role_${n}`, name: `Role ${n}` });
  await RolePermissionModel.create({ role: role._id, permission: permission._id });
  await UserRoleModel.create({ user: accountId, role: role._id });
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

test("account có permission qua role -> getUserInfo trả đúng trong permissions", async () => {
  const account = await createAccount("user");
  await grantPermission(account._id, PERMISSION.HRM_ATTENDANCE_IMPORT);

  const req = { account: { _id: account._id, role: "user" } };
  const res = makeRes();
  await UserController.getUserInfo(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  const body = res.json.mock.calls[0][0];
  expect(body.permissions).toContain(PERMISSION.HRM_ATTENDANCE_IMPORT);
});

test("account không có role/permission nào -> permissions là mảng rỗng", async () => {
  const account = await createAccount("user");

  const req = { account: { _id: account._id, role: "user" } };
  const res = makeRes();
  await UserController.getUserInfo(req, res);

  const body = res.json.mock.calls[0][0];
  expect(body.permissions).toEqual([]);
});

test("admin không tự động có permissions trong danh sách (bypass nằm ở can(), không nằm ở đây)", async () => {
  const account = await createAccount("admin");

  const req = { account: { _id: account._id, role: "admin" } };
  const res = makeRes();
  await UserController.getUserInfo(req, res);

  const body = res.json.mock.calls[0][0];
  expect(body.role).toBe("admin");
  expect(body.permissions).toEqual([]);
});

test("nhánh chưa có UserInfo cũng trả đúng permissions", async () => {
  const account = await createAccount("user");
  await grantPermission(account._id, PERMISSION.HRM_ATTENDANCE_EDIT);

  const req = { account: { _id: account._id, role: "user" } };
  const res = makeRes();
  await UserController.getUserInfo(req, res);

  const body = res.json.mock.calls[0][0];
  expect(body.full_name).toBeNull();
  expect(body.permissions).toContain(PERMISSION.HRM_ATTENDANCE_EDIT);
});
