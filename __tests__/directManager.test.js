process.env.UPLOAD_DIR_PUBLIC_DEV = process.env.UPLOAD_DIR_PUBLIC_DEV || "./uploads";
process.env.UPLOAD_DIR_DEV = process.env.UPLOAD_DIR_DEV || "./uploads";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const UserController = require("../src/controllers/UserController");
const { can } = require("../src/helpers/rbac");
const { getApprovalChain } = require("../src/modules/request/domain/approval-chain");
const AccountModel = require("../src/models/AccountModel");
const UserInfoModel = require("../src/models/UserInfoModel");
const DepartmentModel = require("../src/models/DepartmentModel");
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
const PositionModel = require("../src/models/PositionModel");
const PermissionModel = require("../src/models/PermissionModel");
const UserPermissionModel = require("../src/models/UserPermissionModel");
const { PERMISSION, PERMISSION_EFFECT } = require("../src/constants");
const redisMock = require("./mocks/redis");

// "Quản lý trực tiếp" theo LUỒNG PHÂN QUYỀN CHẤM CÔNG V-WORK (HCNS, 10/2026): HCNS gán trên hồ sơ
// nhân viên (UserInfo.direct_manager); người được gán tự có quyền duyệt; quản lý gián tiếp suy ra =
// quản lý của quản lý trực tiếp.

let mongod;
let position;
let seq = 0;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
  position = await PositionModel.create({ position_name: "Chuyên viên" });
}, 60000);

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
    UserPermissionModel.deleteMany({})
  ]);
  redisMock.__store.clear();
});

async function createEmployee(name) {
  seq += 1;
  const account = await AccountModel.create({ username: `u${seq}`, password: "x", role: "user" });
  const userInfo = await UserInfoModel.create({
    full_name: name,
    cccd: `${seq}`.padStart(12, "0"),
    phone_number: `090${seq}`.padEnd(10, "0"),
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `NV${seq}`,
    employment_type: "fulltime"
  });
  return { account, userInfo };
}

async function createDept(name, { parent = null, manager = null } = {}) {
  seq += 1;
  return DepartmentModel.create({
    department_name: name,
    department_code: `D${seq}`,
    type: "department",
    parent,
    manager
  });
}

async function assignDept(userInfoId, departmentId) {
  return UserDepartmentPositionModel.create({
    user: userInfoId,
    department: departmentId,
    position: position._id
  });
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function setDirectManager(userInfoId, directManager) {
  const res = makeRes();
  await UserController.updateUser(
    {
      params: { id: String(userInfoId) },
      body: { direct_manager: directManager },
      account: { _id: new mongoose.Types.ObjectId(), role: "admin" }
    },
    res
  );
  return res;
}

describe("updateUser — gán quản lý trực tiếp", () => {
  test("gán hợp lệ -> lưu direct_manager; gửi chuỗi rỗng -> bỏ gán", async () => {
    const { userInfo: employee } = await createEmployee("CV Pháp chế");
    const { userInfo: manager } = await createEmployee("TP TCKT");

    const res = await setDirectManager(employee._id, String(manager._id));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(String((await UserInfoModel.findById(employee._id)).direct_manager)).toBe(
      String(manager._id)
    );

    const resClear = await setDirectManager(employee._id, "");
    expect(resClear.status).toHaveBeenCalledWith(200);
    expect((await UserInfoModel.findById(employee._id)).direct_manager).toBeNull();
  });

  test("không cho chọn chính mình", async () => {
    const { userInfo: employee } = await createEmployee("NV");

    const res = await setDirectManager(employee._id, String(employee._id));

    expect(res.status).toHaveBeenCalledWith(400);
    expect((await UserInfoModel.findById(employee._id)).direct_manager).toBeNull();
  });

  test("không cho gán vòng (chọn cấp dưới nhiều tầng làm quản lý)", async () => {
    const { userInfo: deputy } = await createEmployee("Phó TGĐ");
    const { userInfo: head } = await createEmployee("Trưởng phòng");
    const { userInfo: staff } = await createEmployee("Chuyên viên");
    await UserInfoModel.updateOne({ _id: head._id }, { direct_manager: deputy._id });
    await UserInfoModel.updateOne({ _id: staff._id }, { direct_manager: head._id });

    const res = await setDirectManager(deputy._id, String(staff._id));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Không thể chọn cấp dưới của nhân viên này làm quản lý trực tiếp"
    });
  });

  test("người vừa được gán có quyền duyệt ngay (xoá cache RBAC), bỏ gán thì mất quyền", async () => {
    const { userInfo: employee } = await createEmployee("NV");
    const { userInfo: manager, account: managerAccount } = await createEmployee("Trưởng nhóm");

    expect(await can(managerAccount, PERMISSION.HRM_REQUEST_REVIEW)).toBe(false);
    await setDirectManager(employee._id, String(manager._id));
    expect(await can(managerAccount, PERMISSION.HRM_REQUEST_REVIEW)).toBe(true);
    await setDirectManager(employee._id, null);
    expect(await can(managerAccount, PERMISSION.HRM_REQUEST_REVIEW)).toBe(false);
  });
});

describe("RBAC — quản lý theo sơ đồ tổ chức tự có hrm.request.review", () => {
  test("manager của phòng ban (vd Phó TGĐ phụ trách khối) có quyền duyệt", async () => {
    const { userInfo: deputy, account } = await createEmployee("Phó TGĐ");
    await createDept("Khối IT", { manager: deputy._id });

    expect(await can(account, PERMISSION.HRM_REQUEST_REVIEW)).toBe(true);
  });

  test("override DENY cá nhân vẫn thắng quyền ngầm", async () => {
    const { userInfo: employee } = await createEmployee("NV");
    const { userInfo: manager, account } = await createEmployee("Trưởng nhóm");
    await UserInfoModel.updateOne({ _id: employee._id }, { direct_manager: manager._id });
    const permission = await PermissionModel.create({
      code: PERMISSION.HRM_REQUEST_REVIEW,
      group: "hrm"
    });
    await UserPermissionModel.create({
      user: account._id,
      permission: permission._id,
      effect: PERMISSION_EFFECT.DENY
    });

    expect(await can(account, PERMISSION.HRM_REQUEST_REVIEW)).toBe(false);
  });

  test("nhân viên thường không có quyền duyệt", async () => {
    const { account } = await createEmployee("NV");
    expect(await can(account, PERMISSION.HRM_REQUEST_REVIEW)).toBe(false);
  });
});

describe("getApprovalChain — theo sơ đồ khối", () => {
  test("quyền duyệt cũ của người cùng phòng không còn được dùng để suy ra cấp duyệt", async () => {
    const { userInfo: deputy } = await createEmployee("Phó TGĐ Lam");
    const dept = await createDept("Khối Kinh doanh", { manager: deputy._id });
    const { userInfo: formerHead, account: formerHeadAccount } = await createEmployee("Quản lý cũ");
    const { userInfo: staff } = await createEmployee("Chuyên viên Kinh doanh");
    await assignDept(formerHead._id, dept._id);
    await assignDept(staff._id, dept._id);

    const permission = await PermissionModel.create({
      code: PERMISSION.HRM_REQUEST_REVIEW,
      group: "hrm"
    });
    await UserPermissionModel.create({
      user: formerHeadAccount._id,
      permission: permission._id,
      effect: PERMISSION_EFFECT.ALLOW
    });

    const chain = await getApprovalChain(staff._id);

    expect(chain.map((candidate) => candidate.full_name)).toEqual(["Phó TGĐ Lam"]);
    expect(chain.map((candidate) => candidate.source)).toEqual(["branch_leader"]);
  });

  test("CV Pháp chế -> TP TCKT (gán trực tiếp, khác phòng) -> Phó TGĐ Cúc (manager khối TCKT)", async () => {
    const { userInfo: cuc } = await createEmployee("Phó TGĐ Cúc");
    const tckt = await createDept("Khối TCKT", { manager: cuc._id });
    const phapChe = await createDept("Ban Pháp chế");
    const { userInfo: tpTckt } = await createEmployee("TP TCKT");
    await assignDept(tpTckt._id, tckt._id);
    const { userInfo: cvPhapChe } = await createEmployee("CV Pháp chế");
    await assignDept(cvPhapChe._id, phapChe._id);
    await UserInfoModel.updateOne({ _id: cvPhapChe._id }, { direct_manager: tpTckt._id });

    const chain = await getApprovalChain(cvPhapChe._id);

    expect(chain.map((c) => c.full_name)).toEqual(["TP TCKT", "Phó TGĐ Cúc"]);
    expect(chain.map((c) => c.source)).toEqual(["direct_manager", "branch_leader"]);
  });

  test("Trưởng phòng chưa được gán: cấp 1 = Phó TGĐ (manager khối cha), cấp 2 = TGĐ (gán cho Phó TGĐ)", async () => {
    const { userInfo: ceo } = await createEmployee("TGĐ");
    const { userInfo: lam } = await createEmployee("Phó TGĐ Lam");
    await UserInfoModel.updateOne({ _id: lam._id }, { direct_manager: ceo._id });
    const branch = await createDept("Nhánh KD-CN", { manager: lam._id });
    const it = await createDept("Khối IT", { parent: branch._id });
    const { userInfo: tpIt } = await createEmployee("TP IT");
    await assignDept(tpIt._id, it._id);

    const chain = await getApprovalChain(tpIt._id);

    expect(chain.map((c) => c.full_name)).toEqual(["Phó TGĐ Lam", "TGĐ"]);
  });

  test("Phó TGĐ: cấp 1 = TGĐ, không có cấp 2 (không fallback admin)", async () => {
    await AccountModel.create({ username: "admin", password: "x", role: "admin" });
    const { userInfo: ceo } = await createEmployee("TGĐ");
    const { userInfo: cuc } = await createEmployee("Phó TGĐ Cúc");
    await UserInfoModel.updateOne({ _id: cuc._id }, { direct_manager: ceo._id });

    const chain = await getApprovalChain(cuc._id);

    expect(chain.map((c) => c.full_name)).toEqual(["TGĐ"]);
  });

  test("manager của chính phòng mình thì bỏ qua, lấy manager khối cha", async () => {
    const { userInfo: lam } = await createEmployee("Phó TGĐ Lam");
    const branch = await createDept("Nhánh KD-CN", { manager: lam._id });
    const { userInfo: tpMkt } = await createEmployee("TP MKT");
    const mkt = await createDept("Khối MKT", { parent: branch._id, manager: tpMkt._id });
    await assignDept(tpMkt._id, mkt._id);

    const chain = await getApprovalChain(tpMkt._id);

    expect(chain[0].full_name).toBe("Phó TGĐ Lam");
  });
});
