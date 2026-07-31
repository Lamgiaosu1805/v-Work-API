const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  requestHttpController
} = require("../src/modules/request/interface/request.http.controller");
const { asyncHandler } = require("../src/core/http/async-handler");
const { errorHandlerMiddleware } = require("../src/core/http/error-handler.middleware");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const PositionModel = require("../src/models/PositionModel");
const PermissionModel = require("../src/models/PermissionModel");
const RoleModel = require("../src/models/RoleModel");
const RolePermissionModel = require("../src/models/RolePermissionModel");
const UserRoleModel = require("../src/models/UserRoleModel");
const NotificationModel = require("../src/models/NotificationModel");
const { LeaveRequest } = require("../src/models/RequestModel");
const { PERMISSION } = require("../src/constants");
const leaveHandler = require("../src/helpers/leaveHandler");
const redisMock = require("./mocks/redis");

let mongod;
let position;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  // Tránh race "Unable to acquire IX lock" khi 1 collection lần đầu được tạo NGAY
  // trong transaction (xem requestControllerCreate.test.js).
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
  position = await PositionModel.create({ position_name: "Nhân viên" });
}, 60000);

afterAll(async () => {
  // createRequest/reviewRequest publish domain event fire-and-forget (không await) —
  // đợi 1 nhịp để notify của lần gọi cuối cùng kịp query xong trước khi ngắt kết nối,
  // tránh "MongoClientClosedError: Operation interrupted" do disconnect giữa chừng.
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  await mongoose.disconnect();
  await mongod.stop();
});

// Gọi đúng như Express thật sẽ gọi: asyncHandler bắt reject rồi chuyển cho
// errorHandlerMiddleware format response — tái dùng nguyên request.http.controller.js +
// core/http thay vì gọi thẳng RequestController.js (đã xoá ở task 1.15).
async function callController(action, req, res) {
  await asyncHandler(action)(req, res, (error) => errorHandlerMiddleware(error, req, res));
}

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    DepartmentModel.deleteMany({}),
    UserDepartmentPositionModel.deleteMany({}),
    PermissionModel.deleteMany({}),
    RoleModel.deleteMany({}),
    RolePermissionModel.deleteMany({}),
    UserRoleModel.deleteMany({}),
    NotificationModel.deleteMany({}),
    LeaveRequest.deleteMany({})
  ]);
  redisMock.__store.clear();
});

let seq = 0;
const nextSeq = () => {
  seq += 1;
  return seq;
};

async function createDept(name, type, parent = null) {
  return DepartmentModel.create({
    department_name: name,
    department_code: `DEPT-${nextSeq()}`,
    type,
    parent
  });
}

async function createEmployee({ branchId, role = "user" }) {
  const n = nextSeq();
  const account = await AccountModel.create({ username: `user_${n}`, password: "hashed", role });
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
    employment_type: "fulltime",
    branch_id: branchId
  });
  return { account, userInfo };
}

async function assignDept(userInfoId, departmentId) {
  return UserDepartmentPositionModel.create({
    user: userInfoId,
    department: departmentId,
    position: position._id
  });
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
  return role;
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function createLeaveRequest(userInfoId) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return LeaveRequest.create({
    user_id: userInfoId,
    request_type: "leave",
    status: "pending",
    reason: "test",
    from_date: tomorrow,
    from_period: "morning",
    to_date: tomorrow,
    to_period: "afternoon",
    total_days: 1,
    leave_type: "unpaid",
    paid_days: 0,
    unpaid_days: 1
  });
}

async function createLongLeaveRequest(userInfoId, totalDays = 5) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + (totalDays - 1) * 24 * 60 * 60 * 1000);
  return LeaveRequest.create({
    user_id: userInfoId,
    request_type: "leave",
    status: "pending",
    reason: "nghỉ dài ngày",
    from_date: start,
    from_period: "morning",
    to_date: end,
    to_period: "afternoon",
    total_days: totalDays,
    leave_type: "unpaid",
    paid_days: 0,
    unpaid_days: totalDays
  });
}

async function setupTwoReviewers(branchId, dept) {
  const { userInfo: r1, account: a1 } = await createEmployee({ branchId });
  await assignDept(r1._id, dept._id);
  await grantPermission(a1._id, PERMISSION.HRM_REQUEST_REVIEW);

  const { userInfo: r2, account: a2 } = await createEmployee({ branchId });
  await assignDept(r2._id, dept._id);
  await grantPermission(a2._id, PERMISSION.HRM_REQUEST_REVIEW);

  return { r1, a1, r2, a2 };
}

const waitFor = async (fn, { timeoutMs = 2000, intervalMs = 50 } = {}) => {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
};

describe("getAll — authorization động theo approval chain", () => {
  test("manager có hrm.request.review chỉ thấy đơn của nhân viên thuộc phạm vi quản lý", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng A", "department");
    const otherDept = await createDept("Phòng B", "department");

    const { userInfo: manager, account: managerAccount } = await createEmployee({ branchId });
    await assignDept(manager._id, dept._id);
    await grantPermission(managerAccount._id, PERMISSION.HRM_REQUEST_REVIEW);

    const { userInfo: managedEmployee } = await createEmployee({ branchId });
    await assignDept(managedEmployee._id, dept._id);
    await createLeaveRequest(managedEmployee._id);

    const { userInfo: otherEmployee } = await createEmployee({ branchId });
    await assignDept(otherEmployee._id, otherDept._id);
    await createLeaveRequest(otherEmployee._id);

    const req = {
      account: { _id: managerAccount._id.toString(), role: "user", module_access: [] },
      query: {}
    };
    const res = makeRes();
    await callController(requestHttpController.getAll, req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    const { data } = res.json.mock.calls[0][0];
    const userIds = data.map((r) => r.user_id._id.toString());
    expect(userIds).toContain(managedEmployee._id.toString());
    expect(userIds).not.toContain(otherEmployee._id.toString());
  });

  test("user không có permission nào bị 403", async () => {
    const { account } = await createEmployee({ branchId: new mongoose.Types.ObjectId() });
    const req = {
      account: { _id: account._id.toString(), role: "user", module_access: [] },
      query: {}
    };
    const res = makeRes();
    await callController(requestHttpController.getAll, req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("HR (view_all) thấy tất cả đơn, không bị giới hạn theo phòng ban", async () => {
    const { account: hrAccount } = await createEmployee({
      branchId: new mongoose.Types.ObjectId()
    });
    await grantPermission(hrAccount._id, PERMISSION.HRM_REQUEST_VIEW_ALL);

    const { userInfo: employeeA } = await createEmployee({
      branchId: new mongoose.Types.ObjectId()
    });
    const { userInfo: employeeB } = await createEmployee({
      branchId: new mongoose.Types.ObjectId()
    });
    await createLeaveRequest(employeeA._id);
    await createLeaveRequest(employeeB._id);

    const req = {
      account: { _id: hrAccount._id.toString(), role: "user", module_access: [] },
      query: {}
    };
    const res = makeRes();
    await callController(requestHttpController.getAll, req, res);

    const { data } = res.json.mock.calls[0][0];
    expect(data.length).toBe(2);
  });
});

describe("review — authorization động + thông báo dedupe", () => {
  test("quản lý trong chuỗi phê duyệt (không phải cấp gần nhất) vẫn duyệt được", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const division = await createDept("Miền Bắc", "division");
    const dept = await createDept("Phòng Kế toán", "department", division._id);

    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLeaveRequest(employee._id);

    const { userInfo: divisionHead, account: divisionHeadAccount } = await createEmployee({
      branchId
    });
    await assignDept(divisionHead._id, division._id);
    await grantPermission(divisionHeadAccount._id, PERMISSION.HRM_REQUEST_REVIEW);

    const req = {
      account: { _id: divisionHeadAccount._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("approved");
  });

  test("người không thuộc chuỗi phê duyệt bị chặn 403", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLeaveRequest(employee._id);

    const { account: strangerAccount } = await createEmployee({ branchId });

    const req = {
      account: { _id: strangerAccount._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("dedupe: người vừa là quản lý trực tiếp vừa là HR chỉ nhận đúng 1 thông báo", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLeaveRequest(employee._id);

    // M vừa là quản lý trực tiếp (unit_head) vừa là HR (view_all) — 2 đường dẫn cùng trỏ về 1 người
    const { userInfo: manager, account: managerAccount } = await createEmployee({ branchId });
    await assignDept(manager._id, dept._id);
    await grantPermission(managerAccount._id, PERMISSION.HRM_REQUEST_REVIEW);
    await grantPermission(managerAccount._id, PERMISSION.HRM_REQUEST_VIEW_ALL);

    // Người duyệt là 1 admin khác (không phải M) — dùng review_all bypass
    const { account: adminAccount } = await createEmployee({ branchId, role: "admin" });

    const req = {
      account: { _id: adminAccount._id.toString(), role: "admin" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    await waitFor(async () => {
      const count = await NotificationModel.countDocuments({ account_id: employee.id_account });
      return count > 0;
    });

    const managerNotifications = await NotificationModel.countDocuments({
      account_id: managerAccount._id
    });
    expect(managerNotifications).toBe(1);
  });

  test("người vừa duyệt không tự nhận thông báo về hành động của chính mình", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLeaveRequest(employee._id);

    const { userInfo: manager, account: managerAccount } = await createEmployee({ branchId });
    await assignDept(manager._id, dept._id);
    await grantPermission(managerAccount._id, PERMISSION.HRM_REQUEST_REVIEW);

    const req = {
      account: { _id: managerAccount._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    await waitFor(async () => {
      const count = await NotificationModel.countDocuments({ account_id: employee.id_account });
      return count > 0;
    });

    const managerNotifications = await NotificationModel.countDocuments({
      account_id: managerAccount._id
    });
    expect(managerNotifications).toBe(0);
  });
});

describe("review — tier-2 (department.manager) có thể duyệt dù không phải thành viên", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("người được gán department.manager (không thuộc UserDepartmentPositionModel) vẫn duyệt được", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLeaveRequest(employee._id);

    // Phó TGĐ: KHÔNG assignDept — chỉ gán tier-2 trực tiếp trên phòng ban, khác chi nhánh
    const { userInfo: deputy, account: deputyAccount } = await createEmployee({
      branchId: new mongoose.Types.ObjectId()
    });
    await DepartmentModel.updateOne({ _id: dept._id }, { manager: deputy._id });

    const req = {
      account: { _id: deputyAccount._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("approved");
  });
});

describe("review — duyệt 2 người cho đơn nghỉ dài ngày (total_days > 3)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("người thứ 1 duyệt: status vẫn pending, onApprove chưa chạy", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLongLeaveRequest(employee._id);
    const { a1 } = await setupTwoReviewers(branchId, dept);

    const onApproveSpy = jest.spyOn(leaveHandler, "onApprove");

    const req = {
      account: { _id: a1._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("pending");
    expect(updated.approvals.length).toBe(1);
    expect(onApproveSpy).not.toHaveBeenCalled();
  });

  test("người thứ 2 (khác người thứ 1) duyệt tiếp: status → approved, onApprove chạy đúng 1 lần", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLongLeaveRequest(employee._id);
    const { a1, a2 } = await setupTwoReviewers(branchId, dept);

    const onApproveSpy = jest.spyOn(leaveHandler, "onApprove");

    const res1 = makeRes();
    await callController(
      requestHttpController.review,
      {
        account: { _id: a1._id.toString(), role: "user" },
        params: { id: request._id.toString() },
        body: { action: "approve" }
      },
      res1
    );

    const res2 = makeRes();
    await callController(
      requestHttpController.review,
      {
        account: { _id: a2._id.toString(), role: "user" },
        params: { id: request._id.toString() },
        body: { action: "approve" }
      },
      res2
    );

    expect(res2.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("approved");
    expect(updated.approvals.length).toBe(2);
    expect(onApproveSpy).toHaveBeenCalledTimes(1);
  });

  test("cùng 1 người duyệt 2 lần: lần 2 trả 409, không tính là người thứ 2", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLongLeaveRequest(employee._id);
    const { a1 } = await setupTwoReviewers(branchId, dept);

    const reqPayload = {
      account: { _id: a1._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };

    await callController(requestHttpController.review, reqPayload, makeRes());
    const res2 = makeRes();
    await callController(requestHttpController.review, reqPayload, res2);

    expect(res2.status).toHaveBeenCalledWith(409);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("pending");
    expect(updated.approvals.length).toBe(1);
  });

  test("1 trong 2 người từ chối: status → rejected ngay, không cần chờ người còn lại", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLongLeaveRequest(employee._id);
    const { a1 } = await setupTwoReviewers(branchId, dept);

    const onRejectSpy = jest.spyOn(leaveHandler, "onReject");

    const req = {
      account: { _id: a1._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "reject" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("rejected");
    expect(onRejectSpy).toHaveBeenCalledTimes(1);
  });

  test("total_days <= 3: duyệt 1 lần là xong, hành vi y hệt trước khi có tính năng này", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLeaveRequest(employee._id); // total_days = 1
    const { a1 } = await setupTwoReviewers(branchId, dept);

    const req = {
      account: { _id: a1._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("approved");
    expect(updated.approvals.length).toBe(0);
  });

  test("admin (review_all) duyệt đơn nghỉ dài ngày một mình: vẫn chỉ tính 1/2, chưa approved", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLongLeaveRequest(employee._id);

    const { account: adminAccount } = await createEmployee({ branchId, role: "admin" });

    const req = {
      account: { _id: adminAccount._id.toString(), role: "admin" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const res = makeRes();
    await callController(requestHttpController.review, req, res);

    // review_all chỉ bypass yêu cầu "phải nằm trong chuỗi duyệt" — KHÔNG bypass yêu cầu
    // đủ 2 người của đơn nghỉ dài ngày. 1 mình admin không được tự ý duyệt xong.
    expect(res.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("pending");
    expect(updated.approvals.length).toBe(1);
  });

  test("2 admin khác nhau duyệt đơn nghỉ dài ngày: đủ 2 lượt mới approved (admin cũng chỉ tính 1 người)", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLongLeaveRequest(employee._id);

    const { account: adminA } = await createEmployee({ branchId, role: "admin" });
    const { account: adminB } = await createEmployee({ branchId, role: "admin" });

    await callController(
      requestHttpController.review,
      {
        account: { _id: adminA._id.toString(), role: "admin" },
        params: { id: request._id.toString() },
        body: { action: "approve" }
      },
      makeRes()
    );

    const res2 = makeRes();
    await callController(
      requestHttpController.review,
      {
        account: { _id: adminB._id.toString(), role: "admin" },
        params: { id: request._id.toString() },
        body: { action: "approve" }
      },
      res2
    );

    expect(res2.status).toHaveBeenCalledWith(200);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("approved");
    expect(updated.approvals.length).toBe(2);
  });

  test("race: 2 người khác nhau duyệt gần như đồng thời — không mất/thừa lượt, onApprove chỉ chạy 1 lần", async () => {
    const branchId = new mongoose.Types.ObjectId();
    const dept = await createDept("Phòng Kế toán", "department");
    const { userInfo: employee } = await createEmployee({ branchId });
    await assignDept(employee._id, dept._id);
    const request = await createLongLeaveRequest(employee._id);
    const { a1, a2 } = await setupTwoReviewers(branchId, dept);

    const onApproveSpy = jest.spyOn(leaveHandler, "onApprove");

    const reqA = {
      account: { _id: a1._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };
    const reqB = {
      account: { _id: a2._id.toString(), role: "user" },
      params: { id: request._id.toString() },
      body: { action: "approve" }
    };

    const results = await Promise.allSettled([
      callController(requestHttpController.review, reqA, makeRes()),
      callController(requestHttpController.review, reqB, makeRes())
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const updated = await LeaveRequest.findById(request._id);
    expect(updated.status).toBe("approved");
    expect(updated.approvals.length).toBe(2);
    expect(onApproveSpy).toHaveBeenCalledTimes(1);
  });
});
