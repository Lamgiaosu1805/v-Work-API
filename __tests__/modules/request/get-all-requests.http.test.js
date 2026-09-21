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

const UserInfoModel = require("../../../src/models/UserInfoModel");
const AccountModel = require("../../../src/models/AccountModel");
const { LeaveRequest } = require("../../../src/models/RequestModel");
const requestRoutes = require("../../../src/modules/request/interface/request.routes");
const { errorHandlerMiddleware } = require("../../../src/core/http/error-handler.middleware");
const { grantRequestPermission } = require("../../helpers/grantRequestPermission");
const EmployeePermissionProfileModel =
  require("../../../src/models/EmployeePermissionProfileModel").default;
const DepartmentModel = require("../../../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../../../src/models/UserDepartmentPositionModel");
const PositionModel = require("../../../src/models/PositionModel");
const PermissionCatalogModel = require("../../../src/models/PermissionCatalogModel").default;
const DataScopePolicyModel = require("../../../src/models/DataScopePolicyModel").default;
const PermissionRoleModel = require("../../../src/models/PermissionRoleModel").default;

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
  await EmployeePermissionProfileModel.deleteMany({});
  await DepartmentModel.deleteMany({});
  await UserDepartmentPositionModel.deleteMany({});
  jest.clearAllMocks();
});

let position;

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
  await grantRequestPermission(userInfo._id);
  return { account, userInfo };
}

async function createUserInfoNoGrant(n) {
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

async function assignDept(userInfoId, departmentId) {
  if (!position) position = await PositionModel.create({ position_name: "Nhân viên" });
  return UserDepartmentPositionModel.create({
    user: userInfoId,
    department: departmentId,
    position: position._id
  });
}

async function grantOwnDepartmentReview(employeeId) {
  await DataScopePolicyModel.findOneAndUpdate(
    { code: "REQUEST_OWN_DEPARTMENT" },
    {
      code: "REQUEST_OWN_DEPARTMENT",
      entity: "Request",
      label: "Cùng phòng ban",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.user_id",
            operator: "IN",
            right: { type: "SUBJECT_REF", path: "subject.managedEmployeeUserIds" }
          }
        ]
      }
    },
    { upsert: true }
  );
  await PermissionCatalogModel.updateMany(
    { code: { $in: ["request.view", "request.review"] } },
    { $addToSet: { validDataScopePolicies: "REQUEST_OWN_DEPARTMENT" } }
  );
  const role = await PermissionRoleModel.findOneAndUpdate(
    { code: "TEST_REQUEST_OWN_DEPT" },
    {
      code: "TEST_REQUEST_OWN_DEPT",
      name: "Test: own department Request access",
      grants: [
        { permissionCode: "request.view", dataScopePolicyCode: "REQUEST_OWN_DEPARTMENT" },
        { permissionCode: "request.review", dataScopePolicyCode: "REQUEST_OWN_DEPARTMENT" }
      ]
    },
    { upsert: true, new: true }
  );
  await EmployeePermissionProfileModel.findOneAndUpdate(
    { employeeId },
    { employeeId, roleIds: [role._id], overrides: [] },
    { upsert: true }
  );
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

    await LeaveRequest.create(leaveRequestPayload(myInfo._id));
    await LeaveRequest.create(leaveRequestPayload(otherInfo._id));

    const res = await request(app).get("/requests").set("x-test-account", String(me._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(res.body.data[0].user_id._id)).toBe(String(otherInfo._id));
  });

  it("scope OWN_DEPARTMENT (managedEmployeeUserIds): chỉ thấy đơn của nhân viên cùng phòng ban", async () => {
    const dept = await DepartmentModel.create({
      department_name: "Phòng A",
      department_code: "DEPT-A"
    });
    const { account: me, userInfo: myInfo } = await createUserInfoNoGrant(1);
    await assignDept(myInfo._id, dept._id);
    await grantOwnDepartmentReview(myInfo._id);

    const { userInfo: managedInfo } = await createUserInfoNoGrant(2);
    await assignDept(managedInfo._id, dept._id);

    const { userInfo: outOfScopeInfo } = await createUserInfoNoGrant(3);

    await LeaveRequest.create(leaveRequestPayload(myInfo._id));
    await LeaveRequest.create(leaveRequestPayload(managedInfo._id));
    await LeaveRequest.create(leaveRequestPayload(outOfScopeInfo._id));

    const res = await request(app)
      .get("/requests?intent=review")
      .set("x-test-account", String(me._id));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(String(res.body.data[0].user_id._id)).toBe(String(managedInfo._id));
  });

  it("không có permission nào: 403", async () => {
    const { account: me } = await createUserInfoNoGrant(1);

    const res = await request(app).get("/requests").set("x-test-account", String(me._id));

    expect(res.status).toBe(403);
  });

  it("có quyền request.view nhưng không có user_info: 404 message nhất quán với 1.6/1.7", async () => {
    const account = await AccountModel.create({ username: "no-info", password: "x", role: "user" });

    const res = await request(app)
      .get("/requests?intent=review")
      .set("x-test-account", String(account._id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Không tìm thấy thông tin nhân viên" });
  });

  it("search chứa ký tự regex đặc biệt KHÔNG crash (bug thật đã sửa, xem plan)", async () => {
    const { account: me, userInfo: myInfo } = await createUserInfo(1);
    const { userInfo: targetInfo } = await createUserInfo(2, "Nguyen Van A (CN2)");

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

    const res = await request(app)
      .get("/requests?request_type=not_a_real_type")
      .set("x-test-account", String(me._id));

    expect(res.status).toBe(400);
  });
});
