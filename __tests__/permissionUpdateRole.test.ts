import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createRole } from "../src/modules/permission/application/create-role.service";
import { updateRole } from "../src/modules/permission/application/update-role.service";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
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
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({})
  ]);

  await PermissionCatalogModel.create([
    {
      code: "employee.view",
      module: "hrm",
      name: "Xem danh sách nhân viên",
      entity: "Employee",
      actionKind: "READ",
      supportsFieldScope: true,
      validDataScopePolicies: ["ALL_COMPANY", "OWN_DEPARTMENT"],
      validFieldScopePolicies: []
    },
    {
      code: "employee.create",
      module: "hrm",
      name: "Tạo mới nhân viên",
      entity: "Employee",
      actionKind: "WRITE",
      supportsFieldScope: false,
      validDataScopePolicies: ["ALL_COMPANY"],
      validFieldScopePolicies: []
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
    {
      code: "ALL_COMPANY",
      entity: "Employee",
      label: "Toàn công ty",
      conditionTree: { operator: "AND", clauses: [] }
    },
    {
      code: "OWN_DEPARTMENT",
      entity: "Employee",
      label: "Phòng ban của tôi",
      conditionTree: { operator: "AND", clauses: [] }
    },
    {
      code: "DIRECT_REPORTS",
      entity: "Request",
      label: "Cấp dưới trực tiếp",
      conditionTree: { operator: "AND", clauses: [] }
    }
  ]);
});

describe("updateRole", () => {
  test("đổi tên/mô tả -> lưu đúng, không đụng tới grants", async () => {
    const role = await createRole({ name: "Cũ", code: "R1", description: "mô tả cũ" });
    await updateRole(role.id, {
      grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "ALL_COMPANY" }]
    });

    const updated = await updateRole(role.id, { name: "Mới", description: "mô tả mới" });

    expect(updated.name).toBe("Mới");
    expect(updated.description).toBe("mô tả mới");
    expect(updated.grants).toHaveLength(1);
    expect(updated.grants[0].permissionCode).toBe("employee.view");

    const doc = await PermissionRoleModel.findById(role.id).lean();
    expect(doc?.name).toBe("Mới");
  });

  test("thay grants -> tính đúng diff: gỡ cái không còn, thêm cái mới, ghi đè cái trùng", async () => {
    const role = await createRole({ name: "R", code: "R2" });
    await updateRole(role.id, {
      grants: [
        { permissionCode: "employee.view", dataScopePolicyCode: "OWN_DEPARTMENT" },
        { permissionCode: "employee.create", dataScopePolicyCode: "ALL_COMPANY" }
      ]
    });

    const updated = await updateRole(role.id, {
      grants: [
        { permissionCode: "employee.view", dataScopePolicyCode: "ALL_COMPANY" },
        { permissionCode: "request.review", dataScopePolicyCode: "DIRECT_REPORTS" }
      ]
    });

    const codes = updated.grants.map((g) => g.permissionCode).sort();
    expect(codes).toEqual(["employee.view", "request.review"]);

    const viewGrant = updated.grants.find((g) => g.permissionCode === "employee.view");
    expect(viewGrant?.dataScopePolicyCode).toBe("ALL_COMPANY");
  });

  test("sửa tên có khoảng trống đầu/cuối -> tự động trim trước khi lưu, form sửa lần sau không còn khoảng trống", async () => {
    const role = await createRole({ name: "Cũ", code: "R1B" });
    const updated = await updateRole(role.id, { name: "  Tên mới có khoảng trống  " });

    expect(updated.name).toBe("Tên mới có khoảng trống");

    const doc = await PermissionRoleModel.findById(role.id).lean();
    expect(doc?.name).toBe("Tên mới có khoảng trống");
  });

  test("role không tồn tại -> ném NotFoundException", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await expect(updateRole(fakeId, { name: "X" })).rejects.toThrow(NotFoundException);
  });

  test("đổi tên thành rỗng -> entity tự chặn, ném ArgumentInvalidException", async () => {
    const role = await createRole({ name: "R", code: "R3" });
    await expect(updateRole(role.id, { name: "" })).rejects.toThrow(ArgumentInvalidException);
  });

  test("grant thiếu dataScopePolicyCode -> entity chặn qua PermissionGrant VO, ném ArgumentInvalidException", async () => {
    const role = await createRole({ name: "R", code: "R4" });
    await expect(
      updateRole(role.id, {
        grants: [{ permissionCode: "employee.view" } as any]
      })
    ).rejects.toThrow(ArgumentInvalidException);
  });

  test("grant trỏ tới permissionCode không tồn tại (đã bị xóa/gõ sai) -> ném ArgumentInvalidException, không lưu vào DB", async () => {
    const role = await createRole({ name: "R", code: "R5" });
    await expect(
      updateRole(role.id, {
        grants: [{ permissionCode: "employee.NOT_EXIST", dataScopePolicyCode: "ALL_COMPANY" }]
      })
    ).rejects.toThrow(ArgumentInvalidException);

    const doc = await PermissionRoleModel.findById(role.id).lean();
    expect(doc?.grants).toHaveLength(0);
  });

  test("grant trỏ tới dataScopePolicyCode không tồn tại (policy đã bị xóa) -> ném ArgumentInvalidException, không lưu vào DB", async () => {
    const role = await createRole({ name: "R", code: "R6" });
    await expect(
      updateRole(role.id, {
        grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "POLICY_DA_XOA" }]
      })
    ).rejects.toThrow(ArgumentInvalidException);

    const doc = await PermissionRoleModel.findById(role.id).lean();
    expect(doc?.grants).toHaveLength(0);
  });
});
