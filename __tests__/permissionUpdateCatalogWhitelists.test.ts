import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { updatePermissionCatalogWhitelists } from "../src/modules/permission/application/update-permission-catalog-whitelists.service";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import FieldScopePolicyModel from "../src/models/FieldScopePolicyModel";
import { NotFoundException, ArgumentInvalidException } from "../src/core/exceptions/exceptions";

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
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    FieldScopePolicyModel.deleteMany({})
  ]);

  await PermissionCatalogModel.create([
    {
      code: "employee.view",
      module: "hrm",
      name: "Xem danh sách nhân viên",
      entity: "Employee",
      actionKind: "READ",
      supportsFieldScope: true,
      validDataScopePolicies: [],
      validFieldScopePolicies: []
    },
    {
      code: "employee.delete",
      module: "hrm",
      name: "Xóa nhân viên",
      entity: "Employee",
      actionKind: "STRUCTURAL",
      supportsFieldScope: false,
      validDataScopePolicies: [],
      validFieldScopePolicies: []
    }
  ]);

  await DataScopePolicyModel.create([
    { code: "EMPLOYEE_ALL", entity: "Employee", label: "Toàn công ty", conditionTree: null },
    { code: "CUSTOMER_ALL", entity: "Customer", label: "Toàn công ty", conditionTree: null }
  ]);

  await FieldScopePolicyModel.create([
    {
      code: "EMPLOYEE_BASIC",
      entity: "Employee",
      label: "Cơ bản",
      fields: ["full_name"],
      conditionTree: null
    }
  ]);
});

describe("updatePermissionCatalogWhitelists", () => {
  test("gán Data Scope Policy cùng entity -> thành công, lưu đúng vào DB", async () => {
    const result = await updatePermissionCatalogWhitelists("employee.view", {
      validDataScopePolicies: ["EMPLOYEE_ALL"]
    });

    expect(result.validDataScopePolicies).toEqual(["EMPLOYEE_ALL"]);
    const doc = await PermissionCatalogModel.findOne({ code: "employee.view" }).lean();
    expect(doc?.validDataScopePolicies).toEqual(["EMPLOYEE_ALL"]);
  });

  test("gán Data Scope Policy khác entity -> ném ArgumentInvalidException, không lưu", async () => {
    await expect(
      updatePermissionCatalogWhitelists("employee.view", {
        validDataScopePolicies: ["CUSTOMER_ALL"]
      })
    ).rejects.toThrow(ArgumentInvalidException);

    const doc = await PermissionCatalogModel.findOne({ code: "employee.view" }).lean();
    expect(doc?.validDataScopePolicies).toEqual([]);
  });

  test("gán code Data Scope Policy không tồn tại -> ném ArgumentInvalidException", async () => {
    await expect(
      updatePermissionCatalogWhitelists("employee.view", {
        validDataScopePolicies: ["KHONG_TON_TAI"]
      })
    ).rejects.toThrow(ArgumentInvalidException);
  });

  test("gán Field Scope Policy cho permission supportsFieldScope=true -> thành công", async () => {
    const result = await updatePermissionCatalogWhitelists("employee.view", {
      validFieldScopePolicies: ["EMPLOYEE_BASIC"]
    });

    expect(result.validFieldScopePolicies).toEqual(["EMPLOYEE_BASIC"]);
  });

  test("gán Field Scope Policy cho permission STRUCTURAL (supportsFieldScope=false) -> ném ArgumentInvalidException", async () => {
    await expect(
      updatePermissionCatalogWhitelists("employee.delete", {
        validFieldScopePolicies: ["EMPLOYEE_BASIC"]
      })
    ).rejects.toThrow(ArgumentInvalidException);
  });

  test("truyền mảng rỗng -> xóa hết whitelist, không cần validate", async () => {
    await updatePermissionCatalogWhitelists("employee.view", {
      validDataScopePolicies: ["EMPLOYEE_ALL"]
    });

    const result = await updatePermissionCatalogWhitelists("employee.view", {
      validDataScopePolicies: []
    });

    expect(result.validDataScopePolicies).toEqual([]);
  });

  test("permission code không tồn tại -> ném NotFoundException", async () => {
    await expect(
      updatePermissionCatalogWhitelists("khong.ton.tai", { validDataScopePolicies: [] })
    ).rejects.toThrow(NotFoundException);
  });
});
