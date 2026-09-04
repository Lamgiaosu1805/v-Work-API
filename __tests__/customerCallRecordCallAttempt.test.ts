import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import { recordCallAttempt } from "../src/modules/customer-call/application/record-call-attempt.service";
import { ForbiddenException, NotFoundException } from "../src/core/exceptions/exceptions";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import CustomerCallStatsModel from "../src/models/CustomerCallStatsModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function createSale(username: string, fullName: string, maNv: string) {
  const account = await AccountModel.create({ username, password: "x" });
  const userInfo = await UserInfoModel.create({
    full_name: fullName,
    cccd: `${maNv}-cccd`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
  return { account, employeeId: String(userInfo._id) };
}

async function seedCustomerCallPermission(employeeId: string) {
  await PermissionCatalogModel.create({
    code: "customer_call.view",
    module: "crm",
    name: "Xem danh sách khách hàng cần gọi",
    entity: "Customer",
    actionKind: "READ",
    validDataScopePolicies: ["CUSTOMER_SELF_ASSIGNED_ATTEMPT_TEST"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "CUSTOMER_SELF_ASSIGNED_ATTEMPT_TEST",
    entity: "Customer",
    label: "Chỉ khách hàng do mình giới thiệu",
    conditionTree: {
      operator: "AND",
      clauses: [
        {
          left: "resource.referred_by",
          operator: "EQ",
          right: { type: "SUBJECT_REF", path: "subject.userId" }
        }
      ]
    }
  });
  const role = await PermissionRoleModel.create({
    name: "Sale CRM (test)",
    code: "CRM_SALE_ATTEMPT_TEST",
    grants: [
      {
        permissionCode: "customer_call.view",
        dataScopePolicyCode: "CUSTOMER_SELF_ASSIGNED_ATTEMPT_TEST"
      }
    ]
  });
  await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });
}

beforeEach(async () => {
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    CustomerCallStatsModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    AppModel.deleteMany({}),
    CustomerModel.deleteMany({})
  ]);
});

describe("recordCallAttempt (integration, MongoMemoryServer)", () => {
  test("sale trong scope, khách chưa từng gọi -> tạo mới stats, callCount=1", async () => {
    const saleA = await createSale("saleAttemptA", "Sale Attempt A", "NV-ATT-A");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach A" }
    });

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await recordCallAttempt(abilityA, String(customer._id));

    expect(result.callCount).toBe(1);
    const stats = await CustomerCallStatsModel.findOne({ customer_id: customer._id });
    expect(stats!.call_count).toBe(1);
    expect(stats!.last_contacted_at).toBeTruthy();
  });

  test("gọi lần 2 -> callCount tăng lên 2, KHÔNG tạo bản ghi stats mới", async () => {
    const saleA = await createSale("saleAttemptB", "Sale Attempt B", "NV-ATT-B");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111112",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach B" }
    });

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await recordCallAttempt(abilityA, String(customer._id));
    const result = await recordCallAttempt(abilityA, String(customer._id));

    expect(result.callCount).toBe(2);
    const allStats = await CustomerCallStatsModel.find({ customer_id: customer._id });
    expect(allStats).toHaveLength(1);
    expect(allStats[0].call_count).toBe(2);
  });

  test("sale ngoài scope (khách của sale khác) -> ForbiddenException, KHÔNG tạo/tăng stats", async () => {
    const saleA = await createSale("saleAttemptC", "Sale Attempt C", "NV-ATT-C");
    const saleB = await createSale("saleAttemptD", "Sale Attempt D", "NV-ATT-D");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111113",
      referred_by: saleB.employeeId,
      identity: { full_name: "Khach cua sale B" }
    });

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await expect(recordCallAttempt(abilityA, String(customer._id))).rejects.toThrow(
      ForbiddenException
    );

    const stats = await CustomerCallStatsModel.findOne({ customer_id: customer._id });
    expect(stats).toBeNull();
  });

  test("customerId không tồn tại -> NotFoundException", async () => {
    const saleA = await createSale("saleAttemptE", "Sale Attempt E", "NV-ATT-E");
    await seedCustomerCallPermission(saleA.employeeId);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(recordCallAttempt(abilityA, fakeId)).rejects.toThrow(NotFoundException);
  });
});
