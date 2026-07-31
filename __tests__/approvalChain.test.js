const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const {
  getApprovalChain,
  getManagedUserIds
} = require("../src/modules/request/domain/approval-chain");
const { getAccountsWithPermission } = require("../src/helpers/rbac");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const PositionModel = require("../src/models/PositionModel");
const PermissionModel = require("../src/models/PermissionModel");
const RoleModel = require("../src/models/RoleModel");
const RolePermissionModel = require("../src/models/RolePermissionModel");
const UserRoleModel = require("../src/models/UserRoleModel");
const { PERMISSION } = require("../src/constants");
const redisMock = require("./mocks/redis");

let mongod;
let position;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  position = await PositionModel.create({ position_name: "Nhân viên" });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    DepartmentModel.deleteMany({}),
    UserDepartmentPositionModel.deleteMany({}),
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
  const account = await AccountModel.create({
    username: `user_${n}`,
    password: "hashed",
    role
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

// Gán permission hrm.request.review cho 1 account qua role — mô phỏng đúng cách
// RbacController.assignRole hoạt động (role -> role_permission -> user_role).
async function grantReviewPermission(accountId) {
  const n = nextSeq();
  const permission = await PermissionModel.findOneAndUpdate(
    { code: PERMISSION.HRM_REQUEST_REVIEW },
    { $setOnInsert: { code: PERMISSION.HRM_REQUEST_REVIEW, group: "hrm" } },
    { upsert: true, new: true }
  );
  const role = await RoleModel.create({ code: `unit_head_${n}`, name: "Trưởng đơn vị" });
  await RolePermissionModel.create({ role: role._id, permission: permission._id });
  await UserRoleModel.create({ user: accountId, role: role._id });
  return role;
}

test("1. trưởng phòng cùng cấp (level 0) — tìm thấy ngay, không cần đi lên", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");
  const { userInfo: employee } = await createEmployee({ branchId });
  const { userInfo: head, account: headAccount } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);
  await assignDept(head._id, dept._id);
  await grantReviewPermission(headAccount._id);

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(head._id.toString());
});

test("2. phòng ban leaf không có ai đủ quyền — đi lên parent, tìm thấy ở division", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const division = await createDept("Miền Bắc", "division");
  const dept = await createDept("Phòng Kế toán", "department", division._id);

  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  // Đồng nghiệp cùng phòng nhưng KHÔNG có permission
  const { userInfo: peer } = await createEmployee({ branchId });
  await assignDept(peer._id, dept._id);

  const { userInfo: divisionHead, account: divisionHeadAccount } = await createEmployee({
    branchId
  });
  await assignDept(divisionHead._id, division._id);
  await grantReviewPermission(divisionHeadAccount._id);

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(divisionHead._id.toString());
});

test("3. không tìm thấy ai trong toàn bộ cây — trả về mảng rỗng, không lỗi", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const holding = await createDept("Tập đoàn", "holding");
  const board = await createDept("Khối KD", "board", holding._id);
  const division = await createDept("Miền Bắc", "division", board._id);
  const dept = await createDept("Phòng Kế toán", "department", division._id);

  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const chain = await getApprovalChain(employee._id);
  expect(chain).toEqual([]);
});

test("4. khác chi nhánh (dù cùng phòng ban tổ tiên) — luôn bị loại, không ngoại lệ", async () => {
  const branchA = new mongoose.Types.ObjectId();
  const branchB = new mongoose.Types.ObjectId();
  const division = await createDept("Miền Bắc", "division");
  const dept = await createDept("Phòng Kế toán", "department", division._id);

  const { userInfo: employee } = await createEmployee({ branchId: branchA });
  await assignDept(employee._id, dept._id);

  // Trưởng cùng division nhưng khác chi nhánh
  const { userInfo: head, account: headAccount } = await createEmployee({ branchId: branchB });
  await assignDept(head._id, division._id);
  await grantReviewPermission(headAccount._id);

  const chain = await getApprovalChain(employee._id);
  expect(chain).toEqual([]);
});

test("5. cùng chi nhánh nhưng KHÔNG có permission — bị loại", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");
  const { userInfo: employee } = await createEmployee({ branchId });
  const { userInfo: peer } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);
  await assignDept(peer._id, dept._id);
  // Không gọi grantReviewPermission cho peer

  const chain = await getApprovalChain(employee._id);
  expect(chain).toEqual([]);
});

test("6. nhân viên thuộc nhiều phòng ban cùng lúc — gộp điểm xuất phát, không bỏ sót nhánh", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const deptA = await createDept("Phòng A", "department");
  const deptB = await createDept("Phòng B", "department");
  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, deptA._id);
  await assignDept(employee._id, deptB._id);

  const { userInfo: headB, account: headBAccount } = await createEmployee({ branchId });
  await assignDept(headB._id, deptB._id);
  await grantReviewPermission(headBAccount._id);

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(headB._id.toString());
});

test("7. admin luôn pass qua can() dù không được gán permission tay", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");
  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const { userInfo: admin } = await createEmployee({ branchId, role: "admin" });
  await assignDept(admin._id, dept._id);
  // Không grantReviewPermission — admin bypass qua can()

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(admin._id.toString());
});

test("8. getManagedUserIds — manager cấp division thấy nhân viên ở phòng ban con cháu (cùng chi nhánh); không check permission phía nhân viên", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const otherBranchId = new mongoose.Types.ObjectId();
  const division = await createDept("Miền Bắc", "division");
  const dept = await createDept("Phòng Kế toán", "department", division._id);

  const { userInfo: manager } = await createEmployee({ branchId });
  await assignDept(manager._id, division._id);

  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const { userInfo: otherBranchEmployee } = await createEmployee({ branchId: otherBranchId });
  await assignDept(otherBranchEmployee._id, dept._id);

  const managedIds = (await getManagedUserIds(manager._id)).map((id) => id.toString());
  expect(managedIds).toContain(employee._id.toString());
  expect(managedIds).not.toContain(otherBranchEmployee._id.toString());
  expect(managedIds).not.toContain(manager._id.toString());
});

test("9. getAccountsWithPermission — trả đúng danh sách qua role, dedupe khi nhiều role cùng permission", async () => {
  const { account: acc1 } = await createEmployee({ branchId: new mongoose.Types.ObjectId() });
  const { account: acc2 } = await createEmployee({ branchId: new mongoose.Types.ObjectId() });

  const permission = await PermissionModel.create({
    code: PERMISSION.HRM_REQUEST_VIEW_ALL,
    group: "hrm"
  });
  const roleA = await RoleModel.create({ code: "hr_a", name: "HR A" });
  const roleB = await RoleModel.create({ code: "hr_b", name: "HR B" });
  await RolePermissionModel.create({ role: roleA._id, permission: permission._id });
  await RolePermissionModel.create({ role: roleB._id, permission: permission._id });
  // acc1 có cả 2 role cùng permission — phải dedupe còn 1
  await UserRoleModel.create({ user: acc1._id, role: roleA._id });
  await UserRoleModel.create({ user: acc1._id, role: roleB._id });
  await UserRoleModel.create({ user: acc2._id, role: roleA._id });

  const accountIds = (await getAccountsWithPermission(PERMISSION.HRM_REQUEST_VIEW_ALL)).map((id) =>
    id.toString()
  );
  expect(accountIds.sort()).toEqual([acc1._id.toString(), acc2._id.toString()].sort());
  expect(new Set(accountIds).size).toBe(accountIds.length);
});

test("10. stopAtFirstMatch — dừng ngay ở cấp đầu tiên có match, không đi tiếp lên cao hơn", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const holding = await createDept("Tập đoàn", "holding");
  const board = await createDept("Khối KD", "board", holding._id);
  const division = await createDept("Miền Bắc", "division", board._id);
  const dept = await createDept("Phòng Kế toán", "department", division._id);

  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const { userInfo: divisionHead, account: divisionHeadAccount } = await createEmployee({
    branchId
  });
  await assignDept(divisionHead._id, division._id);
  await grantReviewPermission(divisionHeadAccount._id);

  const spy = jest.spyOn(DepartmentModel, "find");
  const chain = await getApprovalChain(employee._id, { stopAtFirstMatch: true });
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(divisionHead._id.toString());
  // Cây có 4 cấp (dept->division->board->holding), match ở division (cấp thứ 2) —
  // nếu dừng đúng thì DepartmentModel.find (bước "lên 1 cấp") chỉ được gọi tối đa 2 lần
  // (1 lần ở dept để lấy parent=division, 1 lần ở division để lấy parent=board TRƯỚC khi
  // check match — nhưng vòng lặp break ngay sau khi thấy match ở division nên không đi tiếp).
  expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  spy.mockRestore();
});

test("11. permission check chạy qua Promise.all — nhiều candidate cùng cấp vẫn ra đúng kết quả", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");
  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const { userInfo: headA, account: headAAccount } = await createEmployee({ branchId });
  const { userInfo: headB, account: headBAccount } = await createEmployee({ branchId });
  const { userInfo: noPermPeer } = await createEmployee({ branchId });
  await assignDept(headA._id, dept._id);
  await assignDept(headB._id, dept._id);
  await assignDept(noPermPeer._id, dept._id);
  await grantReviewPermission(headAAccount._id);
  await grantReviewPermission(headBAccount._id);

  const chain = await getApprovalChain(employee._id);
  const ids = chain.map((c) => c.userInfoId.toString()).sort();
  expect(ids).toEqual([headA._id.toString(), headB._id.toString()].sort());
});

test("12. tier-2 (department.manager) không ai tier-1 — trở thành người gần nhất (level 0)", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");
  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const { userInfo: manager } = await createEmployee({ branchId });
  // KHÔNG assignDept cho manager — không phải thành viên, chỉ gán field manager
  await DepartmentModel.updateOne({ _id: dept._id }, { manager: manager._id });

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(manager._id.toString());
});

test("13. tier-1 và tier-2 cùng tồn tại ở cùng cấp — tier-1 đứng trước", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");
  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const { userInfo: head, account: headAccount } = await createEmployee({ branchId });
  await assignDept(head._id, dept._id);
  await grantReviewPermission(headAccount._id);

  const { userInfo: manager } = await createEmployee({ branchId });
  await DepartmentModel.updateOne({ _id: dept._id }, { manager: manager._id });

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(2);
  expect(chain[0].userInfoId.toString()).toBe(head._id.toString());
  expect(chain[1].userInfoId.toString()).toBe(manager._id.toString());
});

test("14. tier-2 khác chi nhánh với nhân viên — vẫn được tính (khác tier-1)", async () => {
  const branchA = new mongoose.Types.ObjectId();
  const branchB = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");
  const { userInfo: employee } = await createEmployee({ branchId: branchA });
  await assignDept(employee._id, dept._id);

  const { userInfo: manager } = await createEmployee({ branchId: branchB });
  await DepartmentModel.updateOne({ _id: dept._id }, { manager: manager._id });

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(manager._id.toString());
});

test("15. không có manager ở cấp gần, đi lên vài cấp mới có — vẫn tìm thấy", async () => {
  const branchId = new mongoose.Types.ObjectId();
  const holding = await createDept("Tập đoàn", "holding");
  const board = await createDept("Khối KD", "board", holding._id);
  const division = await createDept("Miền Bắc", "division", board._id);
  const dept = await createDept("Phòng Kế toán", "department", division._id);

  const { userInfo: employee } = await createEmployee({ branchId });
  await assignDept(employee._id, dept._id);

  const { userInfo: manager } = await createEmployee({ branchId });
  await DepartmentModel.updateOne({ _id: board._id }, { manager: manager._id });

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(manager._id.toString());
});

test("16. getManagedUserIds — manager chỉ có tier-2 ở phòng ban khác chi nhánh mình — vẫn thấy nhân viên (không lọc branch)", async () => {
  const managerBranchId = new mongoose.Types.ObjectId();
  const employeeBranchId = new mongoose.Types.ObjectId();
  const dept = await createDept("Phòng Kế toán", "department");

  const { userInfo: manager } = await createEmployee({ branchId: managerBranchId });
  await DepartmentModel.updateOne({ _id: dept._id }, { manager: manager._id });

  const { userInfo: employee } = await createEmployee({ branchId: employeeBranchId });
  await assignDept(employee._id, dept._id);

  const managedIds = (await getManagedUserIds(manager._id)).map((id) => id.toString());
  expect(managedIds).toContain(employee._id.toString());
});
