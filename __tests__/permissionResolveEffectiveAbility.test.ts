import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { guard } from "@ucast/mongo2js";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import {
  toMongoQuery,
  maskFields
} from "../src/modules/permission/infrastructure/casl-ability.factory";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import FieldScopePolicyModel from "../src/models/FieldScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

let mongod: MongoMemoryServer;

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
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    FieldScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    UserDepartmentPositionModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);

  await PermissionCatalogModel.create([
    {
      code: "employee.view",
      module: "hrm",
      name: "Xem danh sách nhân viên",
      entity: "Employee",
      actionKind: "READ",
      supportsFieldScope: true,
      validDataScopePolicies: ["ALL_COMPANY"],
      validFieldScopePolicies: ["BASIC"]
    },
    {
      code: "request.review",
      module: "workplace",
      name: "Phê duyệt đơn từ",
      entity: "Request",
      actionKind: "STRUCTURAL",
      supportsFieldScope: false,
      validDataScopePolicies: ["DIRECT_REPORTS"],
      validFieldScopePolicies: []
    }
  ]);

  await DataScopePolicyModel.create([
    { code: "ALL_COMPANY", entity: "Employee", label: "Toàn công ty", conditionTree: null },
    {
      code: "DIRECT_REPORTS",
      entity: "Request",
      label: "Cấp dưới trực tiếp",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.managerId",
            operator: "EQ",
            right: { type: "SUBJECT_REF", path: "subject.userId" }
          }
        ]
      }
    }
  ]);

  await FieldScopePolicyModel.create([
    {
      code: "BASIC",
      entity: "Employee",
      label: "Cơ bản",
      fields: ["name", "department"],
      conditionTree: null
    }
  ]);
});

describe("resolveEffectiveAbility", () => {
  test("Data Scope không điều kiện (ALL_COMPANY) -> filter match mọi document", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", name: "A" })).toBe(true);
    expect(test({ _id: "e2", name: "B" })).toBe(true);
  });

  test("Data Scope có SUBJECT_REF (DIRECT_REPORTS) -> filter chỉ match đúng record của mình", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const role = await PermissionRoleModel.create({
      name: "Quản lý",
      code: "MANAGER",
      grants: [{ permissionCode: "request.review", dataScopePolicyCode: "DIRECT_REPORTS" }]
    });
    await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "request.review", "Request");
    const test = guard(query);

    expect(test({ _id: "r1", managerId: employeeId })).toBe(true);
    expect(test({ _id: "r2", managerId: "nguoi-khac" })).toBe(false);
  });

  test("override BLOCK thắng role -> filter không match gì cả", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF2",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [{ permissionCode: "employee.view", status: "BLOCK" }]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", name: "A" })).toBe(false);
    expect(test({ _id: "e2", name: "B" })).toBe(false);
  });

  test("Allow không giới hạn (ALL_COMPANY) + Deny có Data Scope riêng (cùng phòng ban) -> xem được hết trừ phòng ban của mình", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const ownDepartmentId = new mongoose.Types.ObjectId().toString();
    const otherDepartmentId = new mongoose.Types.ObjectId().toString();

    await UserDepartmentPositionModel.create({
      user: employeeId,
      department: ownDepartmentId,
      position: new mongoose.Types.ObjectId()
    });

    await DataScopePolicyModel.create({
      code: "OWN_DEPARTMENT",
      entity: "Employee",
      label: "Cùng phòng ban",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "SUBJECT_REF", path: "subject.departmentId" }
          }
        ]
      }
    });

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF4",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "OWN_DEPARTMENT",
          fieldScopePolicyCode: null
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", department: ownDepartmentId })).toBe(false);
    expect(test({ _id: "e2", department: otherDepartmentId })).toBe(true);
  });

  test("Field Scope -> maskFields chỉ giữ field trong policy, loại field nhạy cảm", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF3",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });

    const ability = await resolveEffectiveAbility(employeeId);
    const masked = maskFields(ability, "employee.view", "Employee", {
      name: "A",
      department: "D",
      salary: 100
    });

    expect(masked).toEqual({ name: "A", department: "D" });
    expect(masked).not.toHaveProperty("salary");
  });

  test("ID04: 2 role cùng permission, Data Scope TÁCH BIỆT (không chồng lấn) -> mỗi record theo đúng scope của role tương ứng", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create([
      {
        code: "DEPT_X_ONLY",
        entity: "Employee",
        label: "Chỉ phòng X",
        conditionTree: {
          operator: "AND",
          clauses: [
            {
              left: "resource.department",
              operator: "EQ",
              right: { type: "LITERAL", value: "dept-x" }
            }
          ]
        }
      },
      {
        code: "DEPT_Y_ONLY",
        entity: "Employee",
        label: "Chỉ phòng Y",
        conditionTree: {
          operator: "AND",
          clauses: [
            {
              left: "resource.department",
              operator: "EQ",
              right: { type: "LITERAL", value: "dept-y" }
            }
          ]
        }
      }
    ]);

    const roleX = await PermissionRoleModel.create({
      name: "Role X",
      code: "ROLE_X",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_X_ONLY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    const roleY = await PermissionRoleModel.create({
      name: "Role Y",
      code: "ROLE_Y",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_Y_ONLY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [roleX._id, roleY._id],
      overrides: []
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", department: "dept-x" })).toBe(true);
    expect(test({ _id: "e2", department: "dept-y" })).toBe(true);
    expect(test({ _id: "e3", department: "dept-z" })).toBe(false);
  });

  test("ID03: 2 role cùng permission, Data Scope CHỒNG LẤN nhau -> record khớp cả 2 vẫn đúng 1 kết quả (OR), Field Scope 2 role union", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create([
      {
        // Điều kiện theo "status" — chồng lấn với điều kiện "region" ở role kia trên record vừa
        // active vừa ở miền Bắc.
        code: "STATUS_ACTIVE_ID03",
        entity: "Employee",
        label: "Đang hoạt động",
        conditionTree: {
          operator: "AND",
          clauses: [
            { left: "resource.status", operator: "EQ", right: { type: "LITERAL", value: "active" } }
          ]
        }
      },
      {
        code: "REGION_NORTH_ID03",
        entity: "Employee",
        label: "Miền Bắc",
        conditionTree: {
          operator: "AND",
          clauses: [
            { left: "resource.region", operator: "EQ", right: { type: "LITERAL", value: "north" } }
          ]
        }
      }
    ]);
    await FieldScopePolicyModel.create([
      {
        code: "NAME_ONLY_ID03",
        entity: "Employee",
        label: "Chỉ tên",
        fields: ["name"],
        conditionTree: null
      },
      {
        code: "PHONE_ONLY_ID03",
        entity: "Employee",
        label: "Chỉ SĐT",
        fields: ["phone_number"],
        conditionTree: null
      }
    ]);

    const roleActive = await PermissionRoleModel.create({
      name: "Role Active",
      code: "ROLE_ACTIVE_ID03",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "STATUS_ACTIVE_ID03",
          fieldScopePolicyCode: "NAME_ONLY_ID03"
        }
      ]
    });
    const roleNorth = await PermissionRoleModel.create({
      name: "Role North",
      code: "ROLE_NORTH_ID03",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "REGION_NORTH_ID03",
          fieldScopePolicyCode: "PHONE_ONLY_ID03"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [roleActive._id, roleNorth._id],
      overrides: []
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    // Record khớp CẢ 2 điều kiện (active + north) -> vẫn match true (OR, không cần match cả 2).
    expect(test({ _id: "e1", status: "active", region: "north" })).toBe(true);
    // Record chỉ khớp 1 trong 2 điều kiện -> vẫn match nhờ role còn lại.
    expect(test({ _id: "e2", status: "active", region: "south" })).toBe(true);
    expect(test({ _id: "e3", status: "inactive", region: "north" })).toBe(true);
    // Record không khớp điều kiện nào -> không match.
    expect(test({ _id: "e4", status: "inactive", region: "south" })).toBe(false);

    // Record khớp cả 2 điều kiện -> field scope UNION của cả 2 role (name từ role Active + phone_number từ role North).
    const masked = maskFields(ability, "employee.view", "Employee", {
      status: "active",
      region: "north",
      name: "A",
      phone_number: "0900000000",
      salary: 100
    });
    expect(masked).toEqual({ name: "A", phone_number: "0900000000" });
  });

  test("ID05: không gán role nào, chỉ override ALLOW có Data Scope + Field Scope riêng -> áp dụng đúng theo override", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create({
      code: "DEPT_X_ONLY_ID05",
      entity: "Employee",
      label: "Chỉ phòng X",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "LITERAL", value: "dept-x" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create({
      code: "CONTACT_ID05",
      entity: "Employee",
      label: "Liên hệ",
      fields: ["phone_number"],
      conditionTree: null
    });

    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "ALLOW",
          dataScopePolicyCode: "DEPT_X_ONLY_ID05",
          fieldScopePolicyCode: "CONTACT_ID05"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);
    expect(test({ _id: "e1", department: "dept-x" })).toBe(true);
    expect(test({ _id: "e2", department: "dept-y" })).toBe(false);

    const masked = maskFields(ability, "employee.view", "Employee", {
      department: "dept-x",
      phone_number: "0900000000",
      salary: 100
    });
    expect(masked).toEqual({ phone_number: "0900000000" });
  });

  test("ID08: Role + Override ALLOW cùng permission, Data Scope trùng, Field Scope khác nhau -> field UNION", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await FieldScopePolicyModel.create({
      code: "CONTACT_ID08",
      entity: "Employee",
      label: "Liên hệ",
      fields: ["phone_number"],
      conditionTree: null
    });

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID08",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "ALLOW",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "CONTACT_ID08"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const masked = maskFields(ability, "employee.view", "Employee", {
      name: "A",
      department: "D",
      phone_number: "0900000000",
      salary: 100
    });

    expect(masked).toEqual({ name: "A", department: "D", phone_number: "0900000000" });
    expect(masked).not.toHaveProperty("salary");
  });

  test("ID09: Role + Override ALLOW cùng permission, Data Scope khác nhau, Field Scope trùng -> Data Scope UNION", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create([
      {
        code: "DEPT_X_ONLY_ID09",
        entity: "Employee",
        label: "Chỉ phòng X",
        conditionTree: {
          operator: "AND",
          clauses: [
            {
              left: "resource.department",
              operator: "EQ",
              right: { type: "LITERAL", value: "dept-x" }
            }
          ]
        }
      },
      {
        code: "DEPT_Y_ONLY_ID09",
        entity: "Employee",
        label: "Chỉ phòng Y",
        conditionTree: {
          operator: "AND",
          clauses: [
            {
              left: "resource.department",
              operator: "EQ",
              right: { type: "LITERAL", value: "dept-y" }
            }
          ]
        }
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID09",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_X_ONLY_ID09",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "ALLOW",
          dataScopePolicyCode: "DEPT_Y_ONLY_ID09",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", department: "dept-x" })).toBe(true);
    expect(test({ _id: "e2", department: "dept-y" })).toBe(true);
    expect(test({ _id: "e3", department: "dept-z" })).toBe(false);
  });

  test("ID13: Override BLOCK có Data Scope rộng hơn role (bao trùm) -> chặn toàn bộ, kể cả trong phạm vi role", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create({
      code: "DEPT_X_ONLY_ID13",
      entity: "Employee",
      label: "Chỉ phòng X",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "LITERAL", value: "dept-x" }
          }
        ]
      }
    });

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID13",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_X_ONLY_ID13",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: null
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    // dept-x nằm trong phạm vi role cấp, nhưng Deny rộng hơn (ALL_COMPANY) vẫn chặn được.
    expect(test({ _id: "e1", department: "dept-x" })).toBe(false);
  });

  test("ID12 (role>quyền, không Field Scope): Override BLOCK không có Field Scope -> chặn toàn bộ field = loại cả record trong phạm vi Data Scope bị chặn", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const ownDepartmentId = new mongoose.Types.ObjectId().toString();
    const otherDepartmentId = new mongoose.Types.ObjectId().toString();

    await UserDepartmentPositionModel.create({
      user: employeeId,
      department: ownDepartmentId,
      position: new mongoose.Types.ObjectId()
    });

    await DataScopePolicyModel.create({
      code: "OWN_DEPARTMENT_ID12",
      entity: "Employee",
      label: "Cùng phòng ban",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "SUBJECT_REF", path: "subject.departmentId" }
          }
        ]
      }
    });

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID12B",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "OWN_DEPARTMENT_ID12",
          fieldScopePolicyCode: null
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", department: ownDepartmentId })).toBe(false);
    expect(test({ _id: "e2", department: otherDepartmentId })).toBe(true);
  });

  test("ID14 (role>quyền, Field Scope Deny ⊂ Field Scope Role): record vẫn hiện trong list, chỉ bị trừ bớt field trong phạm vi Deny hẹp hơn", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const ownDepartmentId = new mongoose.Types.ObjectId().toString();
    const otherDepartmentId = new mongoose.Types.ObjectId().toString();

    await UserDepartmentPositionModel.create({
      user: employeeId,
      department: ownDepartmentId,
      position: new mongoose.Types.ObjectId()
    });

    await DataScopePolicyModel.create({
      code: "OWN_DEPARTMENT_ID15",
      entity: "Employee",
      label: "Cùng phòng ban",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "SUBJECT_REF", path: "subject.departmentId" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create([
      {
        code: "FULL_ID15",
        entity: "Employee",
        label: "Đầy đủ",
        fields: ["name", "department", "phone_number"],
        conditionTree: null
      },
      {
        code: "CONTACT_ONLY_ID15",
        entity: "Employee",
        label: "Chỉ SĐT",
        fields: ["phone_number"],
        conditionTree: null
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID15",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "FULL_ID15"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "OWN_DEPARTMENT_ID15",
          fieldScopePolicyCode: "CONTACT_ONLY_ID15"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);

    // Record trong phạm vi Deny vẫn nằm trong kết quả (KHÔNG bị loại) — chỉ mất field bị Deny trừ.
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);
    expect(test({ _id: "e1", department: ownDepartmentId })).toBe(true);
    expect(test({ _id: "e2", department: otherDepartmentId })).toBe(true);

    const maskedInDeniedScope = maskFields(ability, "employee.view", "Employee", {
      department: ownDepartmentId,
      name: "A",
      phone_number: "0900000000"
    });
    expect(maskedInDeniedScope).toEqual({ name: "A", department: ownDepartmentId });

    const maskedOutsideDeniedScope = maskFields(ability, "employee.view", "Employee", {
      department: otherDepartmentId,
      name: "B",
      phone_number: "0911111111"
    });
    expect(maskedOutsideDeniedScope).toEqual({
      name: "B",
      department: otherDepartmentId,
      phone_number: "0911111111"
    });
  });

  test("ID20 (role=quyền, Field Scope Deny ⊂ Field Scope Role): record vẫn dùng được, chỉ mất đúng field bị Deny trừ", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await FieldScopePolicyModel.create([
      {
        code: "FULL_ID20",
        entity: "Employee",
        label: "Đầy đủ",
        fields: ["name", "department", "phone_number"],
        conditionTree: null
      },
      {
        code: "CONTACT_ONLY_ID20",
        entity: "Employee",
        label: "Chỉ SĐT",
        fields: ["phone_number"],
        conditionTree: null
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID20",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "FULL_ID20"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          // Deny dùng ĐÚNG cùng 1 Data Scope Policy với role (ALL_COMPANY) -> role = quyền,
          // Field Scope hẹp hơn role -> theo ma trận QA (ID20): vẫn dùng được, chỉ mất field bị chặn.
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "CONTACT_ONLY_ID20"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);

    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);
    expect(test({ _id: "e1", department: "bat-ky-phong-ban-nao" })).toBe(true);

    const masked = maskFields(ability, "employee.view", "Employee", {
      name: "A",
      department: "d1",
      phone_number: "0900000000"
    });
    expect(masked).toEqual({ name: "A", department: "d1" });
  });

  test("ID17 (role<quyền — Deny bao trùm role, Field Scope Deny ⊂ Field Scope Role): vẫn dùng được ở MỌI record trong phạm vi role hẹp, chỉ mất đúng field bị Deny trừ", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create({
      code: "DEPT_X_ONLY_ID17",
      entity: "Employee",
      label: "Chỉ phòng X",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "LITERAL", value: "dept-x" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create([
      {
        code: "FULL_ID17",
        entity: "Employee",
        label: "Đầy đủ",
        fields: ["name", "department", "phone_number"],
        conditionTree: null
      },
      {
        code: "CONTACT_ONLY_ID17",
        entity: "Employee",
        label: "Chỉ SĐT",
        fields: ["phone_number"],
        conditionTree: null
      }
    ]);

    // role chỉ được cấp trong phạm vi HẸP (dept-x) -> Deny dùng ALL_COMPANY (rộng hơn hẳn, bao trùm
    // toàn bộ phạm vi role) = role < quyền. Deny CÓ Field Scope hẹp hơn role (chỉ phone_number).
    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID17",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_X_ONLY_ID17",
          fieldScopePolicyCode: "FULL_ID17"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "CONTACT_ONLY_ID17"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);

    // Deny bao trùm toàn bộ phạm vi role (role<quyền) — nhưng vì Deny có Field Scope hẹp hơn, record
    // trong đúng phạm vi role KHÔNG bị loại khỏi kết quả, chỉ mất field bị Deny trừ.
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);
    expect(test({ _id: "e1", department: "dept-x" })).toBe(true);

    const masked = maskFields(ability, "employee.view", "Employee", {
      department: "dept-x",
      name: "A",
      phone_number: "0900000000"
    });
    expect(masked).toEqual({ name: "A", department: "dept-x" });
  });

  test("ID18 (role<quyền, Field Scope Deny = Field Scope Role): 0 field còn lại -> maskFields trả về rỗng dù record chưa bị loại khỏi list", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create({
      code: "DEPT_X_ONLY_ID18",
      entity: "Employee",
      label: "Chỉ phòng X",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "LITERAL", value: "dept-x" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create({
      code: "BASIC_ID18",
      entity: "Employee",
      label: "Cơ bản",
      fields: ["name", "department"],
      conditionTree: null
    });

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID18",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_X_ONLY_ID18",
          fieldScopePolicyCode: "BASIC_ID18"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          // Deny rộng hơn role (ALL_COMPANY > DEPT_X_ONLY) VÀ Field Scope trùng khớp hoàn toàn với
          // role -> theo ma trận QA (ID18): không thể sử dụng (0 field còn lại).
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC_ID18"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);

    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);
    expect(test({ _id: "e1", department: "dept-x" })).toBe(true);

    const masked = maskFields(ability, "employee.view", "Employee", {
      department: "dept-x",
      name: "A"
    });
    expect(masked).toEqual({});
  });

  test("ID15 (role>quyền, Field Scope Deny = Field Scope Role): 0 field còn lại trong phạm vi Deny hẹp, nhưng vẫn đủ field ngoài phạm vi đó", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const ownDepartmentId = new mongoose.Types.ObjectId().toString();
    const otherDepartmentId = new mongoose.Types.ObjectId().toString();

    await UserDepartmentPositionModel.create({
      user: employeeId,
      department: ownDepartmentId,
      position: new mongoose.Types.ObjectId()
    });
    await DataScopePolicyModel.create({
      code: "OWN_DEPARTMENT_ID15",
      entity: "Employee",
      label: "Cùng phòng ban",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "SUBJECT_REF", path: "subject.departmentId" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create({
      code: "BASIC_ID15",
      entity: "Employee",
      label: "Cơ bản",
      fields: ["name", "department"],
      conditionTree: null
    });

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID15B",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC_ID15"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          // Deny hẹp hơn role (OWN_DEPARTMENT < ALL_COMPANY) VÀ Field Scope trùng khớp hoàn toàn ->
          // theo ma trận QA (ID15): trong phạm vi hẹp, 0 field còn lại.
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "OWN_DEPARTMENT_ID15",
          fieldScopePolicyCode: "BASIC_ID15"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);

    const maskedInDeniedScope = maskFields(ability, "employee.view", "Employee", {
      department: ownDepartmentId,
      name: "A"
    });
    expect(maskedInDeniedScope).toEqual({});

    const maskedOutside = maskFields(ability, "employee.view", "Employee", {
      department: otherDepartmentId,
      name: "B"
    });
    expect(maskedOutside).toEqual({ name: "B", department: otherDepartmentId });
  });

  test("ID16 (role>quyền, Field Scope Deny ⊃ Field Scope Role): 0 field còn lại trong phạm vi Deny hẹp (Deny chặn nhiều hơn cả role cấp)", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const ownDepartmentId = new mongoose.Types.ObjectId().toString();

    await UserDepartmentPositionModel.create({
      user: employeeId,
      department: ownDepartmentId,
      position: new mongoose.Types.ObjectId()
    });
    await DataScopePolicyModel.create({
      code: "OWN_DEPARTMENT_ID16",
      entity: "Employee",
      label: "Cùng phòng ban",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "SUBJECT_REF", path: "subject.departmentId" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create([
      {
        code: "NAME_ONLY_ID16",
        entity: "Employee",
        label: "Chỉ tên",
        fields: ["name"],
        conditionTree: null
      },
      {
        code: "FULL_ID16",
        entity: "Employee",
        label: "Đầy đủ",
        fields: ["name", "department", "phone_number"],
        conditionTree: null
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID16",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "NAME_ONLY_ID16"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "OWN_DEPARTMENT_ID16",
          fieldScopePolicyCode: "FULL_ID16"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const masked = maskFields(ability, "employee.view", "Employee", {
      department: ownDepartmentId,
      name: "A"
    });
    expect(masked).toEqual({});
  });

  test("ID19 (role<quyền — Deny bao trùm role, Field Scope Deny ⊃ Field Scope Role): 0 field còn lại ở khắp mọi record trong phạm vi role", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create({
      code: "DEPT_X_ONLY_ID19",
      entity: "Employee",
      label: "Chỉ phòng X",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "LITERAL", value: "dept-x" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create([
      {
        code: "NAME_ONLY_ID19",
        entity: "Employee",
        label: "Chỉ tên",
        fields: ["name"],
        conditionTree: null
      },
      {
        code: "FULL_ID19",
        entity: "Employee",
        label: "Đầy đủ",
        fields: ["name", "department", "phone_number"],
        conditionTree: null
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID19",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_X_ONLY_ID19",
          fieldScopePolicyCode: "NAME_ONLY_ID19"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "FULL_ID19"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const masked = maskFields(ability, "employee.view", "Employee", {
      department: "dept-x",
      name: "A"
    });
    expect(masked).toEqual({});
  });

  test("ID21 (role=quyền, Field Scope Deny = Field Scope Role): 0 field còn lại", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await FieldScopePolicyModel.create({
      code: "BASIC_ID21",
      entity: "Employee",
      label: "Cơ bản",
      fields: ["name", "department"],
      conditionTree: null
    });

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID21",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC_ID21"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BASIC_ID21"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const masked = maskFields(ability, "employee.view", "Employee", {
      name: "A",
      department: "d1"
    });
    expect(masked).toEqual({});
  });

  test("ID22 (role=quyền, Field Scope Deny ⊃ Field Scope Role): 0 field còn lại", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await FieldScopePolicyModel.create([
      {
        code: "NAME_ONLY_ID22",
        entity: "Employee",
        label: "Chỉ tên",
        fields: ["name"],
        conditionTree: null
      },
      {
        code: "FULL_ID22",
        entity: "Employee",
        label: "Đầy đủ",
        fields: ["name", "department", "phone_number"],
        conditionTree: null
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID22",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "NAME_ONLY_ID22"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "FULL_ID22"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const masked = maskFields(ability, "employee.view", "Employee", { name: "A" });
    expect(masked).toEqual({});
  });

  test("ID24 (role<quyền — Deny bao trùm role, Field Scope 'giao nhau' 1 phần): trừ đúng field trùng, giữ lại field role có mà deny không đụng tới", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await DataScopePolicyModel.create({
      code: "DEPT_X_ONLY_ID24",
      entity: "Employee",
      label: "Chỉ phòng X",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.department",
            operator: "EQ",
            right: { type: "LITERAL", value: "dept-x" }
          }
        ]
      }
    });
    await FieldScopePolicyModel.create([
      {
        // Role cấp field name, phone_number — Deny chặn phone_number, salary (chỉ phone_number
        // trùng với role, salary thì role còn không cấp).
        code: "AB_ID24",
        entity: "Employee",
        label: "A+B",
        fields: ["name", "phone_number"],
        conditionTree: null
      },
      {
        code: "BC_ID24",
        entity: "Employee",
        label: "B+C",
        fields: ["phone_number", "salary"],
        conditionTree: null
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID24",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "DEPT_X_ONLY_ID24",
          fieldScopePolicyCode: "AB_ID24"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BC_ID24"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);
    const masked = maskFields(ability, "employee.view", "Employee", {
      department: "dept-x",
      name: "A",
      phone_number: "0900000000",
      salary: 100
    });
    expect(masked).toEqual({ name: "A" });
  });

  test("ID25 (role=quyền, Field Scope 'giao nhau' 1 phần): chỉ trừ đúng field trùng, còn lại field không trùng của role", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();

    await FieldScopePolicyModel.create([
      {
        // Role cấp field name, phone_number — Deny chặn phone_number, salary (chỉ phone_number
        // trùng với role, salary thì role không cấp).
        code: "AB_ID25",
        entity: "Employee",
        label: "A+B",
        fields: ["name", "phone_number"],
        conditionTree: null
      },
      {
        code: "BC_ID25",
        entity: "Employee",
        label: "B+C",
        fields: ["phone_number", "salary"],
        conditionTree: null
      }
    ]);

    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ID25",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "AB_ID25"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [
        {
          permissionCode: "employee.view",
          status: "BLOCK",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "BC_ID25"
        }
      ]
    });

    const ability = await resolveEffectiveAbility(employeeId);

    const masked = maskFields(ability, "employee.view", "Employee", {
      name: "A",
      phone_number: "0900000000",
      salary: 100
    });
    // Deny trừ đúng phone_number (phần giao nhau) — name (field role có mà deny không đụng tới) vẫn còn.
    expect(masked).toEqual({ name: "A" });
  });

  test("nhân viên chưa có profile/role nào -> không có quyền gì", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", name: "A" })).toBe(false);
  });

  test("Data Scope Policy dùng subject.accountId (vd Post tự quản) -> resolveEffectiveAbility KHÔNG throw, filter theo đúng accountId thật của account (không phải employeeId)", async () => {
    const account = await AccountModel.create({ username: "author1", password: "x" });
    const userInfo = await UserInfoModel.create({
      full_name: "Tác giả",
      cccd: "000000000001",
      phone_number: "0900000001",
      sex: 1,
      date_of_birth: new Date("1990-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: account._id,
      ma_nv: "NV-ACC-01",
      employment_type: "fulltime"
    });
    const employeeId = String(userInfo._id);

    await PermissionCatalogModel.create({
      code: "post.edit",
      module: "workplace",
      name: "Sửa bài đăng",
      entity: "Post",
      actionKind: "WRITE",
      supportsFieldScope: false,
      validDataScopePolicies: ["POST_SELF_ASSIGNED"],
      validFieldScopePolicies: []
    });
    await DataScopePolicyModel.create({
      code: "POST_SELF_ASSIGNED",
      entity: "Post",
      label: "Chỉ bài của chính mình",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.author_id",
            operator: "EQ",
            right: { type: "SUBJECT_REF", path: "subject.accountId" }
          }
        ]
      }
    });
    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF_ACCOUNT_ID",
      grants: [{ permissionCode: "post.edit", dataScopePolicyCode: "POST_SELF_ASSIGNED" }]
    });
    await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });

    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "post.edit", "Post");
    const test = guard(query);

    expect(test({ _id: "p1", author_id: String(account._id) })).toBe(true);
    expect(test({ _id: "p2", author_id: "nguoi-khac" })).toBe(false);
  });
});
