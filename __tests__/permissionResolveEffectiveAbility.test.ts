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
    UserDepartmentPositionModel.deleteMany({})
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

  test("nhân viên chưa có profile/role nào -> không có quyền gì", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const ability = await resolveEffectiveAbility(employeeId);
    const query = toMongoQuery(ability, "employee.view", "Employee");
    const test = guard(query);

    expect(test({ _id: "e1", name: "A" })).toBe(false);
  });
});
