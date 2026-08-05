const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { getEffectivePermissions, can } = require("../src/helpers/rbac");
const RbacController = require("../src/controllers/RbacController");
const RoleModel = require("../src/models/RoleModel");
const PermissionModel = require("../src/models/PermissionModel");
const RolePermissionModel = require("../src/models/RolePermissionModel");
const UserRoleModel = require("../src/models/UserRoleModel");
const UserPermissionModel = require("../src/models/UserPermissionModel");
const AccountModel = require("../src/models/AccountModel");
const { PERMISSION, PERMISSION_VALUES, PERMISSION_EFFECT, ROLE } = require("../src/constants");
const redisMock = require("./mocks/redis");

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

// Fixture RBAC cho test (rbacDefinitions.js đã bỏ, production không còn seed).
// Dữ liệu test thuần để kiểm chứng resolver — KHÔNG phải ma trận quyền chính thức.
const PERMISSIONS = PERMISSION_VALUES.map((code) => ({ code, group: "kpi", description: code }));

const ROLES = [
  {
    code: "kpi_sale",
    name: "Sale",
    description: "Nhân viên kinh doanh",
    permissions: [PERMISSION.KPI_DASHBOARD_VIEW, PERMISSION.KPI_REPORT_SUBMIT]
  },
  {
    code: "kpi_sale_manager",
    name: "Trưởng phòng KD",
    description: "Trưởng phòng kinh doanh",
    permissions: [PERMISSION.KPI_DASHBOARD_VIEW, PERMISSION.KPI_ASSIGNMENT_MANAGE]
  },
  {
    code: "kpi_ttkd_director",
    name: "Giám đốc TTKD",
    description: "Giám đốc trung tâm kinh doanh",
    permissions: [
      PERMISSION.KPI_DASHBOARD_VIEW,
      PERMISSION.KPI_YEAR_PLAN_ALLOCATE,
      PERMISSION.KPI_TIER_CONFIG,
      PERMISSION.KPI_MONTHEND_CLOSE
    ]
  },
  {
    code: "kpi_bod",
    name: "BOD",
    description: "Ban điều hành",
    permissions: [
      PERMISSION.KPI_DASHBOARD_VIEW,
      PERMISSION.KPI_METRIC_MANAGE,
      PERMISSION.KPI_YEAR_PLAN_ASSIGN
    ]
  }
];

let mongod;
const ACCOUNT_ID = new mongoose.Types.ObjectId();

// Seed RBAC ngay trong test (job seedRbac.js đã bị bỏ khỏi codebase) — upsert
// permission/role/liên kết từ rbacDefinitions, idempotent giống logic seed cũ.
async function seedRbac() {
  const permIdByCode = {};
  for (const p of PERMISSIONS) {
    const doc = await PermissionModel.findOneAndUpdate(
      { code: p.code },
      { $set: { group: p.group, description: p.description, isDeleted: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    permIdByCode[p.code] = doc._id;
  }
  for (const r of ROLES) {
    const role = await RoleModel.findOneAndUpdate(
      { code: r.code },
      { $set: { name: r.name, description: r.description, isDeleted: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    for (const code of r.permissions) {
      const permId = permIdByCode[code];
      if (!permId) continue;
      await RolePermissionModel.updateOne(
        { role: role._id, permission: permId },
        { $setOnInsert: { role: role._id, permission: permId }, $set: { isDeleted: false } },
        { upsert: true }
      );
    }
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await seedRbac();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  redisMock.__store.clear(); // tránh cache rò rỉ giữa các test
});

describe("seedRbac", () => {
  test("tạo đủ permission & role từ rbacDefinitions", async () => {
    expect(await PermissionModel.countDocuments({ isDeleted: false })).toBe(
      PERMISSION_VALUES.length
    );
    expect(await RoleModel.countDocuments({ isDeleted: false })).toBe(4);
  });

  test("chạy 2 lần không sinh trùng (idempotent)", async () => {
    await seedRbac();
    expect(await RoleModel.countDocuments({ isDeleted: false })).toBe(4);
  });
});

describe("getEffectivePermissions + can", () => {
  beforeEach(async () => {
    await UserRoleModel.deleteMany({});
    await UserPermissionModel.deleteMany({});
  });

  test("user gán role kpi_sale có đúng quyền của role", async () => {
    const saleRole = await RoleModel.findOne({ code: "kpi_sale" });
    await UserRoleModel.create({ user: ACCOUNT_ID, role: saleRole._id });

    const perms = await getEffectivePermissions(ACCOUNT_ID);
    expect(perms.has(PERMISSION.KPI_DASHBOARD_VIEW)).toBe(true);
    expect(perms.has(PERMISSION.KPI_REPORT_SUBMIT)).toBe(true);
    expect(perms.has(PERMISSION.KPI_METRIC_MANAGE)).toBe(false); // quyền của BOD
  });

  test("override ALLOW cấp thêm quyền ngoài role", async () => {
    const saleRole = await RoleModel.findOne({ code: "kpi_sale" });
    await UserRoleModel.create({ user: ACCOUNT_ID, role: saleRole._id });
    const perm = await PermissionModel.findOne({ code: PERMISSION.KPI_TIER_CONFIG });
    await UserPermissionModel.create({
      user: ACCOUNT_ID,
      permission: perm._id,
      effect: PERMISSION_EFFECT.ALLOW
    });

    const perms = await getEffectivePermissions(ACCOUNT_ID);
    expect(perms.has(PERMISSION.KPI_TIER_CONFIG)).toBe(true);
  });

  test("override DENY chặn quyền role đã cấp", async () => {
    const saleRole = await RoleModel.findOne({ code: "kpi_sale" });
    await UserRoleModel.create({ user: ACCOUNT_ID, role: saleRole._id });
    const perm = await PermissionModel.findOne({ code: PERMISSION.KPI_DASHBOARD_VIEW });
    await UserPermissionModel.create({
      user: ACCOUNT_ID,
      permission: perm._id,
      effect: PERMISSION_EFFECT.DENY
    });

    const perms = await getEffectivePermissions(ACCOUNT_ID);
    expect(perms.has(PERMISSION.KPI_DASHBOARD_VIEW)).toBe(false);
  });

  test("can(): admin bypass mọi quyền dù không gán role", async () => {
    const admin = { role: ROLE.ADMIN, _id: new mongoose.Types.ObjectId() };
    expect(await can(admin, PERMISSION.KPI_METRIC_MANAGE)).toBe(true);
  });

  test("can(): user không có quyền → false", async () => {
    const user = { role: ROLE.USER, _id: new mongoose.Types.ObjectId() };
    expect(await can(user, PERMISSION.KPI_METRIC_MANAGE)).toBe(false);
  });
});

describe("RbacController.getUserAccess", () => {
  beforeEach(async () => {
    await UserRoleModel.deleteMany({});
    await UserPermissionModel.deleteMany({});
  });

  test("trả về user_permissions (override thô) bên cạnh roles + effective_permissions", async () => {
    const account = await AccountModel.create({
      username: `rbac_test_${Date.now()}`,
      password: "hashed",
      role: "user"
    });
    const saleRole = await RoleModel.findOne({ code: "kpi_sale" });
    await UserRoleModel.create({ user: account._id, role: saleRole._id });
    const perm = await PermissionModel.findOne({ code: PERMISSION.KPI_TIER_CONFIG });
    await UserPermissionModel.create({
      user: account._id,
      permission: perm._id,
      effect: PERMISSION_EFFECT.ALLOW
    });

    const req = { params: { accountId: account._id.toString() } };
    const res = makeRes();
    await RbacController.getUserAccess(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { data } = res.json.mock.calls[0][0];
    expect(data.roles.map((r) => r.code)).toEqual(["kpi_sale"]);
    expect(data.user_permissions).toEqual([
      { code: PERMISSION.KPI_TIER_CONFIG, effect: PERMISSION_EFFECT.ALLOW }
    ]);
    expect(data.effective_permissions).toEqual(
      expect.arrayContaining([PERMISSION.KPI_TIER_CONFIG, PERMISSION.KPI_DASHBOARD_VIEW])
    );
  });
});

describe("RbacController.addPermissionToRole / removePermissionFromRole", () => {
  beforeEach(async () => {
    await UserRoleModel.deleteMany({});
    await UserPermissionModel.deleteMany({});
    // Đảm bảo kpi_sale không có sẵn KPI_METRIC_MANAGE trước mỗi test (đúng fixture gốc).
    const saleRole = await RoleModel.findOne({ code: "kpi_sale" });
    const perm = await PermissionModel.findOne({ code: PERMISSION.KPI_METRIC_MANAGE });
    await RolePermissionModel.updateOne(
      { role: saleRole._id, permission: perm._id },
      { $set: { isDeleted: true } }
    );
  });

  test("thêm permission vào role → user đang giữ role đó có ngay effective_permissions mới", async () => {
    const account = await AccountModel.create({
      username: `rbac_add_role_perm_${Date.now()}`,
      password: "hashed",
      role: "user"
    });
    const saleRole = await RoleModel.findOne({ code: "kpi_sale" });
    await UserRoleModel.create({ user: account._id, role: saleRole._id });

    const before = await getEffectivePermissions(account._id);
    expect(before.has(PERMISSION.KPI_METRIC_MANAGE)).toBe(false);

    const req = {
      params: { roleCode: "kpi_sale" },
      body: { permissionCode: PERMISSION.KPI_METRIC_MANAGE }
    };
    const res = makeRes();
    await RbacController.addPermissionToRole(req, res);
    expect(res.status).toHaveBeenCalledWith(200);

    // Cache đã được invalidate trong addPermissionToRole cho mọi user giữ role này —
    // không cần chờ TTL 60s.
    const after = await getEffectivePermissions(account._id);
    expect(after.has(PERMISSION.KPI_METRIC_MANAGE)).toBe(true);
  });

  test("gỡ permission khỏi role → biến mất khỏi effective_permissions của user giữ role đó", async () => {
    const account = await AccountModel.create({
      username: `rbac_remove_role_perm_${Date.now()}`,
      password: "hashed",
      role: "user"
    });
    const saleRole = await RoleModel.findOne({ code: "kpi_sale" });
    await UserRoleModel.create({ user: account._id, role: saleRole._id });

    await RbacController.addPermissionToRole(
      { params: { roleCode: "kpi_sale" }, body: { permissionCode: PERMISSION.KPI_METRIC_MANAGE } },
      makeRes()
    );
    const mid = await getEffectivePermissions(account._id);
    expect(mid.has(PERMISSION.KPI_METRIC_MANAGE)).toBe(true);

    const res = makeRes();
    await RbacController.removePermissionFromRole(
      {
        params: { roleCode: "kpi_sale", permissionCode: PERMISSION.KPI_METRIC_MANAGE }
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);

    const after = await getEffectivePermissions(account._id);
    expect(after.has(PERMISSION.KPI_METRIC_MANAGE)).toBe(false);
    // Quyền gốc của role vẫn còn nguyên, không bị ảnh hưởng
    expect(after.has(PERMISSION.KPI_DASHBOARD_VIEW)).toBe(true);
  });
});
