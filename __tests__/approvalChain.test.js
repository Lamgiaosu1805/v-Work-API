const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { getApprovalChain } = require("../src/modules/request/domain/approval-chain");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const PositionModel = require("../src/models/PositionModel");
const PermissionCatalogModel = require("../src/models/PermissionCatalogModel").default;
const DataScopePolicyModel = require("../src/models/DataScopePolicyModel").default;
const PermissionRoleModel = require("../src/models/PermissionRoleModel").default;
const EmployeePermissionProfileModel =
  require("../src/models/EmployeePermissionProfileModel").default;

let mongod;
let position;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  position = await PositionModel.create({ position_name: "Nhân viên" });

  await DataScopePolicyModel.create({
    code: "REQUEST_ALL_COMPANY",
    entity: "Request",
    label: "Toàn công ty",
    conditionTree: null
  });
  await DataScopePolicyModel.create({
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
  });
  await PermissionCatalogModel.create({
    code: "request.review",
    module: "hrm",
    name: "Duyệt/từ chối đơn từ",
    entity: "Request",
    actionKind: "STRUCTURAL",
    validDataScopePolicies: ["REQUEST_ALL_COMPANY", "REQUEST_OWN_DEPARTMENT"]
  });

  await PermissionRoleModel.create({
    code: "TEST_DEPT_LEAD",
    name: "Test: Trưởng phòng",
    grants: [{ permissionCode: "request.review", dataScopePolicyCode: "REQUEST_OWN_DEPARTMENT" }]
  });
  await PermissionRoleModel.create({
    code: "TEST_ADMIN",
    name: "Test: Admin toàn quyền",
    grants: [{ permissionCode: "request.review", dataScopePolicyCode: "REQUEST_ALL_COMPANY" }]
  });
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

let seq = 0;
const nextSeq = () => {
  seq += 1;
  return seq;
};

async function createDept(name, parent = null) {
  return DepartmentModel.create({
    department_name: name,
    department_code: `DEPT-${nextSeq()}`,
    type: "department",
    parent
  });
}

async function createEmployee() {
  const n = nextSeq();
  const account = await AccountModel.create({ username: `user_${n}`, password: "hashed" });
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
  return UserDepartmentPositionModel.create({
    user: userInfoId,
    department: departmentId,
    position: position._id
  });
}

async function assignRole(employeeId, roleCode) {
  const role = await PermissionRoleModel.findOne({ code: roleCode });
  const existing = await EmployeePermissionProfileModel.findOne({ employeeId });
  if (existing) {
    await EmployeePermissionProfileModel.updateOne(
      { employeeId },
      { $addToSet: { roleIds: role._id } }
    );
  } else {
    await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });
  }
}

afterEach(async () => {
  await AccountModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  await DepartmentModel.deleteMany({});
  await UserDepartmentPositionModel.deleteMany({});
  await EmployeePermissionProfileModel.deleteMany({});
});

test("1. trưởng phòng cùng phòng ban (DEPT_LEAD, scope OWN_DEPARTMENT) — tìm thấy", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  const { userInfo: head } = await createEmployee();
  await assignDept(employee._id, dept._id);
  await assignDept(head._id, dept._id);
  await assignRole(head._id, "TEST_DEPT_LEAD");

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(head._id.toString());
});

test("2. trưởng phòng cấp trên (division cha) quản lý xuyên phòng con — tìm thấy", async () => {
  const division = await createDept("Miền Bắc");
  const dept = await createDept("Phòng Kế toán", division._id);
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const { userInfo: peer } = await createEmployee();
  await assignDept(peer._id, dept._id);

  const { userInfo: divisionHead } = await createEmployee();
  await assignDept(divisionHead._id, division._id);
  await assignRole(divisionHead._id, "TEST_DEPT_LEAD");

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(divisionHead._id.toString());
});

test("3. không ai có quyền duyệt phù hợp — trả về mảng rỗng, không lỗi", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const chain = await getApprovalChain(employee._id);
  expect(chain).toEqual([]);
});

test("4. cùng phòng nhưng KHÔNG giữ role review nào — bị loại", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  const { userInfo: peer } = await createEmployee();
  await assignDept(employee._id, dept._id);
  await assignDept(peer._id, dept._id);

  const chain = await getApprovalChain(employee._id);
  expect(chain).toEqual([]);
});

test("5. khác phòng ban hoàn toàn (không phải tổ tiên/con cháu) — bị loại", async () => {
  const deptA = await createDept("Phòng A");
  const deptB = await createDept("Phòng B");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, deptA._id);

  const { userInfo: head } = await createEmployee();
  await assignDept(head._id, deptB._id);
  await assignRole(head._id, "TEST_DEPT_LEAD");

  const chain = await getApprovalChain(employee._id);
  expect(chain).toEqual([]);
});

test("6. admin (scope ALL_COMPANY) luôn thấy, không phụ thuộc phòng ban", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const { userInfo: admin } = await createEmployee();
  await assignRole(admin._id, "TEST_ADMIN");

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(admin._id.toString());
});

test("7. có cả trưởng phòng lẫn admin — trưởng phòng (scope hẹp hơn) đứng trước admin (scope rộng)", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const { userInfo: head } = await createEmployee();
  await assignDept(head._id, dept._id);
  await assignRole(head._id, "TEST_DEPT_LEAD");

  const { userInfo: admin } = await createEmployee();
  await assignRole(admin._id, "TEST_ADMIN");

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(2);
  expect(chain[0].userInfoId.toString()).toBe(head._id.toString());
  expect(chain[1].userInfoId.toString()).toBe(admin._id.toString());
});

test("7b. 3 tầng ưu tiên cùng lúc — cùng phòng > quản lý gián tiếp (division) > admin toàn công ty", async () => {
  const division = await createDept("Miền Bắc");
  const dept = await createDept("Phòng Kế toán", division._id);
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const { userInfo: admin } = await createEmployee();
  await assignRole(admin._id, "TEST_ADMIN");

  const { userInfo: divisionHead } = await createEmployee();
  await assignDept(divisionHead._id, division._id);
  await assignRole(divisionHead._id, "TEST_DEPT_LEAD");

  const { userInfo: deptHead } = await createEmployee();
  await assignDept(deptHead._id, dept._id);
  await assignRole(deptHead._id, "TEST_DEPT_LEAD");

  const chain = await getApprovalChain(employee._id);
  expect(chain.map((c) => c.userInfoId.toString())).toEqual([
    deptHead._id.toString(),
    divisionHead._id.toString(),
    admin._id.toString()
  ]);
});

test("7c. cùng phòng NHƯNG cũng giữ thêm quyền admin — vẫn xếp theo cùng phòng (rank 0), không tụt xuống rank admin", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const { userInfo: adminOutside } = await createEmployee();
  await assignRole(adminOutside._id, "TEST_ADMIN");

  const { userInfo: headAlsoAdmin } = await createEmployee();
  await assignDept(headAlsoAdmin._id, dept._id);
  await assignRole(headAlsoAdmin._id, "TEST_DEPT_LEAD");
  await assignRole(headAlsoAdmin._id, "TEST_ADMIN");

  const chain = await getApprovalChain(employee._id);
  expect(chain.map((c) => c.userInfoId.toString())).toEqual([
    headAlsoAdmin._id.toString(),
    adminOutside._id.toString()
  ]);
});

test("8. nhiều người cùng giữ DEPT_LEAD ở cùng phòng — trả về đủ tất cả", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const { userInfo: headA } = await createEmployee();
  const { userInfo: headB } = await createEmployee();
  await assignDept(headA._id, dept._id);
  await assignDept(headB._id, dept._id);
  await assignRole(headA._id, "TEST_DEPT_LEAD");
  await assignRole(headB._id, "TEST_DEPT_LEAD");

  const chain = await getApprovalChain(employee._id);
  const ids = chain.map((c) => c.userInfoId.toString()).sort();
  expect(ids).toEqual([headA._id.toString(), headB._id.toString()].sort());
});

test("9. chính chủ đơn không tự xuất hiện trong danh sách duyệt của chính mình", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);
  await assignRole(employee._id, "TEST_DEPT_LEAD");

  const chain = await getApprovalChain(employee._id);
  expect(chain).toEqual([]);
});

test("10. giữ cả 2 role (DEPT_LEAD + ADMIN) chỉ xuất hiện đúng 1 lần (dedupe)", async () => {
  const dept = await createDept("Phòng Kế toán");
  const { userInfo: employee } = await createEmployee();
  await assignDept(employee._id, dept._id);

  const { userInfo: head } = await createEmployee();
  await assignDept(head._id, dept._id);
  await assignRole(head._id, "TEST_DEPT_LEAD");
  await assignRole(head._id, "TEST_ADMIN");

  const chain = await getApprovalChain(employee._id);
  expect(chain).toHaveLength(1);
  expect(chain[0].userInfoId.toString()).toBe(head._id.toString());
});
