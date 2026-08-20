import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import redisMock from "./mocks/redis";
import { buildPermissionCacheKey } from "../src/core/authorization/permission-cache-key";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import {
  onRoleDeleted,
  onEmployeePermissionUpdated,
  onDataScopePolicyChanged,
  onFieldScopePolicyChanged
} from "../src/modules/permission/application/handlers/invalidate-permission-cache.handler";
import { RoleDeletedDomainEvent } from "../src/modules/permission/domain/events/role-deleted.domain-event";
import { EmployeePermissionUpdatedDomainEvent } from "../src/modules/permission/domain/events/employee-permission-updated.domain-event";
import { DataScopePolicyChangedDomainEvent } from "../src/modules/permission/domain/events/data-scope-policy-changed.domain-event";
import { FieldScopePolicyChangedDomainEvent } from "../src/modules/permission/domain/events/field-scope-policy-changed.domain-event";

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
  redisMock.__store.clear();
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({})
  ]);
});

const newId = () => new mongoose.Types.ObjectId().toString();

describe("invalidate-permission-cache.handler", () => {
  test("onRoleDeleted -> xóa đúng cache của affectedEmployeeIds, không đụng nhân viên khác", async () => {
    const [e1, e2, e3] = [newId(), newId(), newId()];
    await redisMock.set(buildPermissionCacheKey(e1), "cached");
    await redisMock.set(buildPermissionCacheKey(e2), "cached");
    await redisMock.set(buildPermissionCacheKey(e3), "cached");

    await onRoleDeleted(
      new RoleDeletedDomainEvent({
        aggregateId: newId(),
        roleCode: "R1",
        affectedEmployeeIds: [e1, e2]
      })
    );

    expect(redisMock.__store.has(buildPermissionCacheKey(e1))).toBe(false);
    expect(redisMock.__store.has(buildPermissionCacheKey(e2))).toBe(false);
    expect(redisMock.__store.has(buildPermissionCacheKey(e3))).toBe(true);
  });

  test("onEmployeePermissionUpdated -> chỉ xóa cache đúng 1 nhân viên", async () => {
    const [e1, e2] = [newId(), newId()];
    await redisMock.set(buildPermissionCacheKey(e1), "cached");
    await redisMock.set(buildPermissionCacheKey(e2), "cached");

    await onEmployeePermissionUpdated(
      new EmployeePermissionUpdatedDomainEvent({ aggregateId: newId(), employeeId: e1 })
    );

    expect(redisMock.__store.has(buildPermissionCacheKey(e1))).toBe(false);
    expect(redisMock.__store.has(buildPermissionCacheKey(e2))).toBe(true);
  });

  test("onDataScopePolicyChanged -> xóa cache của mọi nhân viên đang giữ role tham chiếu đúng policy đó", async () => {
    const [e1, e2] = [newId(), newId()];
    const role = await PermissionRoleModel.create({
      name: "R",
      code: "R_DSP",
      grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "POLICY_X" }]
    });
    const otherRole = await PermissionRoleModel.create({
      name: "Other",
      code: "R_OTHER",
      grants: [{ permissionCode: "employee.view", dataScopePolicyCode: "POLICY_Y" }]
    });
    await EmployeePermissionProfileModel.create([
      { employeeId: e1, roleIds: [role._id], overrides: [] },
      { employeeId: e2, roleIds: [otherRole._id], overrides: [] }
    ]);

    await redisMock.set(buildPermissionCacheKey(e1), "cached");
    await redisMock.set(buildPermissionCacheKey(e2), "cached");

    await onDataScopePolicyChanged(
      new DataScopePolicyChangedDomainEvent({ aggregateId: newId(), policyCode: "POLICY_X" })
    );

    expect(redisMock.__store.has(buildPermissionCacheKey(e1))).toBe(false);
    expect(redisMock.__store.has(buildPermissionCacheKey(e2))).toBe(true);
  });

  test("onFieldScopePolicyChanged -> xóa cache của mọi nhân viên đang giữ role tham chiếu đúng policy đó", async () => {
    const e1 = newId();
    const role = await PermissionRoleModel.create({
      name: "R",
      code: "R_FSP",
      grants: [
        {
          permissionCode: "employee.view",
          dataScopePolicyCode: "ALL_COMPANY",
          fieldScopePolicyCode: "FIELD_X"
        }
      ]
    });
    await EmployeePermissionProfileModel.create({
      employeeId: e1,
      roleIds: [role._id],
      overrides: []
    });

    await redisMock.set(buildPermissionCacheKey(e1), "cached");

    await onFieldScopePolicyChanged(
      new FieldScopePolicyChangedDomainEvent({ aggregateId: newId(), policyCode: "FIELD_X" })
    );

    expect(redisMock.__store.has(buildPermissionCacheKey(e1))).toBe(false);
  });

  test("affectedEmployeeIds rỗng -> không gọi Redis, không lỗi", async () => {
    await expect(
      onRoleDeleted(
        new RoleDeletedDomainEvent({
          aggregateId: newId(),
          roleCode: "R2",
          affectedEmployeeIds: []
        })
      )
    ).resolves.toBeUndefined();
  });
});
