import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMyEffectivePermissions } from "../src/modules/permission/application/get-my-effective-permissions.service";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";

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
    EmployeePermissionProfileModel.deleteMany({})
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
      validFieldScopePolicies: []
    },
    {
      code: "request.review",
      module: "hrm",
      name: "Phê duyệt đơn từ",
      entity: "Request",
      actionKind: "STRUCTURAL",
      supportsFieldScope: false,
      validDataScopePolicies: ["REQUEST_ALL"],
      validFieldScopePolicies: []
    },
    {
      code: "customer.view",
      module: "crm",
      name: "Xem khách hàng",
      entity: "Customer",
      actionKind: "READ",
      supportsFieldScope: true,
      validDataScopePolicies: ["CUSTOMER_ALL"],
      validFieldScopePolicies: []
    }
  ]);

  await DataScopePolicyModel.create([
    { code: "ALL_COMPANY", entity: "Employee", label: "Toàn công ty", conditionTree: null },
    { code: "REQUEST_ALL", entity: "Request", label: "Toàn công ty", conditionTree: null },
    { code: "CUSTOMER_ALL", entity: "Customer", label: "Toàn công ty", conditionTree: null }
  ]);
});

describe("getMyEffectivePermissions", () => {
  test("chưa có profile -> mảng rỗng", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const permissions = await getMyEffectivePermissions(employeeId);
    expect(permissions).toEqual([]);
  });

  test("có role gán quyền -> permission code đó xuất hiện trong kết quả", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF",
      grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "ALL_COMPANY" }]
    });
    await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });

    const permissions = await getMyEffectivePermissions(employeeId);
    expect(permissions).toEqual(["employee.view"]);
  });

  test("nhiều permission qua nhiều role -> gộp đủ, không trùng lặp", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const role1 = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF2",
      grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "ALL_COMPANY" }]
    });
    const role2 = await PermissionRoleModel.create({
      name: "Quản lý",
      code: "MANAGER",
      grants: [
        { permissionCode: "employee.view", dataScopePolicyCode: "ALL_COMPANY" },
        { permissionCode: "request.review", dataScopePolicyCode: "REQUEST_ALL" }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role1._id, role2._id],
      overrides: []
    });

    const permissions = await getMyEffectivePermissions(employeeId);
    expect(permissions.sort()).toEqual(["employee.view", "request.review"]);
  });

  test("override BLOCK không điều kiện -> xoá permission dù role đang cấp", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    const role = await PermissionRoleModel.create({
      name: "Nhân viên",
      code: "STAFF3",
      grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "ALL_COMPANY" }]
    });
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: [{ permissionCode: "employee.view", status: "BLOCK" }]
    });

    const permissions = await getMyEffectivePermissions(employeeId);
    expect(permissions).toEqual([]);
  });

  test("override ALLOW không qua role nào -> permission vẫn xuất hiện", async () => {
    const employeeId = new mongoose.Types.ObjectId().toString();
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [],
      overrides: [{ permissionCode: "customer.view", status: "ALLOW" }]
    });

    const permissions = await getMyEffectivePermissions(employeeId);
    expect(permissions).toEqual(["customer.view"]);
  });
});
