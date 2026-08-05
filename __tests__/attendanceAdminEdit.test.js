const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const AttendanceController = require("../src/controllers/AttendanceController");
const { requirePermission } = require("../src/helpers/rbac");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const WorkSheetModel = require("../src/models/WorkSheetModel");
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
    WorkSheetModel.deleteMany({}),
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

async function createWorksheet() {
  const n = nextSeq();
  const employeeAccount = await createAccount();
  const userInfo = await UserInfoModel.create({
    full_name: `NV ${n}`,
    cccd: `${n}`.padStart(12, "0"),
    phone_number: `090${n}`.padEnd(10, "0"),
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: employeeAccount._id,
    ma_nv: `NV${n}`,
    employment_type: "fulltime"
  });
  return WorkSheetModel.create({ user_id: userInfo._id, date: new Date(), shifts: [] });
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

describe("adminEditWorksheet — audit trail", () => {
  test("sửa work_unit thành công ghi edited_by/edited_at", async () => {
    const worksheet = await createWorksheet();
    const editorAccount = await createAccount("admin");

    const req = {
      params: { worksheetId: worksheet._id.toString() },
      body: { work_unit: 1 },
      account: { _id: editorAccount._id.toString() }
    };
    const res = makeRes();
    await AttendanceController.adminEditWorksheet(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await WorkSheetModel.findById(worksheet._id);
    expect(updated.work_unit).toBe(1);
    expect(updated.edited_by.toString()).toBe(editorAccount._id.toString());
    expect(updated.edited_at).toBeInstanceOf(Date);
  });

  test("sửa lần 2 bởi account khác ghi đè snapshot (không phải lịch sử)", async () => {
    const worksheet = await createWorksheet();
    const editor1 = await createAccount("admin");
    const editor2 = await createAccount("admin");

    await AttendanceController.adminEditWorksheet(
      {
        params: { worksheetId: worksheet._id.toString() },
        body: { work_unit: 1 },
        account: { _id: editor1._id.toString() }
      },
      makeRes()
    );

    await AttendanceController.adminEditWorksheet(
      {
        params: { worksheetId: worksheet._id.toString() },
        body: { work_unit: 0.5 },
        account: { _id: editor2._id.toString() }
      },
      makeRes()
    );

    const updated = await WorkSheetModel.findById(worksheet._id);
    expect(updated.work_unit).toBe(0.5);
    expect(updated.edited_by.toString()).toBe(editor2._id.toString());
  });

  test("work_unit không hợp lệ (âm) → 400, không đổi worksheet", async () => {
    const worksheet = await createWorksheet();
    const editorAccount = await createAccount("admin");

    const req = {
      params: { worksheetId: worksheet._id.toString() },
      body: { work_unit: -1 },
      account: { _id: editorAccount._id.toString() }
    };
    const res = makeRes();
    await AttendanceController.adminEditWorksheet(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const unchanged = await WorkSheetModel.findById(worksheet._id);
    expect(unchanged.edited_by).toBeNull();
    expect(unchanged.edited_at).toBeNull();
  });
});

describe("requirePermission — gate cho hrm.attendance.edit/import", () => {
  test("account không có permission bị chặn (không gọi next)", async () => {
    const account = await createAccount("user");
    const middleware = requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT);
    const req = { account: { _id: account._id.toString(), role: "user" } };
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("account có permission (qua role) được cho qua", async () => {
    const account = await createAccount("user");
    await grantPermission(account._id, PERMISSION.HRM_ATTENDANCE_EDIT);
    const middleware = requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT);
    const req = { account: { _id: account._id.toString(), role: "user" } };
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("admin luôn qua dù không được gán permission tay", async () => {
    const account = await createAccount("admin");
    const middleware = requirePermission(PERMISSION.HRM_ATTENDANCE_IMPORT);
    const req = { account: { _id: account._id.toString(), role: "admin" } };
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("account có permission import nhưng không có permission edit vẫn bị chặn ở edit", async () => {
    const account = await createAccount("user");
    await grantPermission(account._id, PERMISSION.HRM_ATTENDANCE_IMPORT);
    const middleware = requirePermission(PERMISSION.HRM_ATTENDANCE_EDIT);
    const req = { account: { _id: account._id.toString(), role: "user" } };
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
