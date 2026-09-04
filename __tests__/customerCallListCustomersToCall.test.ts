import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import { listCustomersToCall } from "../src/modules/customer-call/application/list-customers-to-call.service";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import CustomerCallStatsModel from "../src/models/CustomerCallStatsModel";
import CustomerSaleRelationshipModel from "../src/models/CustomerSaleRelationshipModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const InvestmentModel = require("../src/models/InvestmentModel");

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
    supportsFieldScope: true,
    validDataScopePolicies: ["CUSTOMER_SELF_ASSIGNED_TEST"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "CUSTOMER_SELF_ASSIGNED_TEST",
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
    code: "CRM_SALE_TEST",
    grants: [
      { permissionCode: "customer_call.view", dataScopePolicyCode: "CUSTOMER_SELF_ASSIGNED_TEST" }
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
    CustomerSaleRelationshipModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    AppModel.deleteMany({}),
    CustomerModel.deleteMany({}),
    InvestmentModel.deleteMany({})
  ]);
});

describe("listCustomersToCall (integration, MongoMemoryServer)", () => {
  test("scope SELF_ASSIGNED khớp đúng qua aggregate với referred_by là ObjectId thật -> không trả rỗng, chỉ thấy khách của mình + đúng app", async () => {
    const saleA = await createSale("saleA", "Sale A", "NV-A");
    const saleB = await createSale("saleB", "Sale B", "NV-B");
    await seedCustomerCallPermission(saleA.employeeId);

    const appTikluy = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const appVnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });

    await CustomerModel.create([
      {
        app_id: appTikluy._id,
        phone_number: "0911111111",
        referred_by: saleA.employeeId,
        identity: { full_name: "Khach A Mot" }
      },
      {
        app_id: appTikluy._id,
        phone_number: "0933333333",
        referred_by: saleB.employeeId,
        identity: { full_name: "Khach B Mot" }
      },
      {
        app_id: appVnfite._id,
        phone_number: "0944444444",
        referred_by: saleA.employeeId,
        identity: { full_name: "Khach A App Khac" }
      }
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCustomersToCall(abilityA, { appCode: "tikluy", page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0911111111");
  });

  test("search khớp cả tên khách của sale khác -> KHÔNG lộ khách ngoài scope (điều kiện scope không bị $or search ghi đè)", async () => {
    const saleA = await createSale("saleA2", "Sale A2", "NV-A2");
    const saleB = await createSale("saleB2", "Sale B2", "NV-B2");
    await seedCustomerCallPermission(saleA.employeeId);

    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });

    await CustomerModel.create([
      {
        app_id: app._id,
        phone_number: "0911111111",
        referred_by: saleA.employeeId,
        identity: { full_name: "Khach A Mot" }
      },
      {
        app_id: app._id,
        phone_number: "0933333333",
        referred_by: saleB.employeeId,
        identity: { full_name: "Khach B Mot" }
      }
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCustomersToCall(abilityA, {
      appCode: "tikluy",
      page: 1,
      limit: 20,
      search: "Khach"
    });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0911111111");
  });

  test("search theo tên (không có chữ số) -> chỉ khớp đúng khách hàng có tên trùng, không trả về toàn bộ", async () => {
    const saleA = await createSale("saleA3", "Sale A3", "NV-A3");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });

    await CustomerModel.create([
      {
        app_id: app._id,
        phone_number: "0911111111",
        referred_by: saleA.employeeId,
        identity: { full_name: "Nguyen Van Mot" }
      },
      {
        app_id: app._id,
        phone_number: "0922222222",
        referred_by: saleA.employeeId,
        identity: { full_name: null }
      }
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCustomersToCall(abilityA, {
      appCode: "tikluy",
      page: 1,
      limit: 20,
      search: "Mot"
    });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0911111111");
  });

  test("relationshipStatus/saleName/derivedStatus resolve đúng qua $lookup (đúng tên collection thật)", async () => {
    const saleA = await createSale("saleA4", "Sale A4", "NV-A4");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });

    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId,
      external_id: "EXT-KHACH-01",
      identity: { full_name: "Khach Da Dau Tu", verified_at: new Date() }
    });

    await CustomerSaleRelationshipModel.create({
      customer_id: customer._id,
      sale_id: saleA.employeeId,
      status: "friended",
      updated_by: saleA.account._id
    });

    await InvestmentModel.create({
      app_id: app._id,
      customer_id: customer._id,
      external_investment_id: "ext-1",
      product_name: "Sản phẩm test",
      amount: 1000000,
      term_type: "month",
      term_value: 6,
      interest_rate: 10,
      invested_at: new Date(),
      maturity_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180),
      status: "active"
    });

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCustomersToCall(abilityA, { appCode: "tikluy", page: 1, limit: 20 });

    expect(result.total).toBe(1);
    const item = result.data[0] as any;
    expect(item.relationshipStatus).toBe("friended");
    expect(item.saleName).toBe("Sale A4");
    expect(item.derivedStatus).toBe("dang_dau_tu");
    expect(item.external_id).toBe("EXT-KHACH-01");
  });

  test("callCount='gt3' -> chỉ trả về khách hàng có call_count > 3, không gồm đúng 3", async () => {
    const saleA = await createSale("saleA5", "Sale A5", "NV-A5");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });

    const customer3Calls = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach Goi 3 Lan" }
    });
    const customer4Calls = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0922222222",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach Goi 4 Lan" }
    });

    await CustomerCallStatsModel.create({
      customer_id: customer3Calls._id,
      call_count: 3,
      last_contacted_at: new Date()
    });
    await CustomerCallStatsModel.create({
      customer_id: customer4Calls._id,
      call_count: 4,
      last_contacted_at: new Date()
    });

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCustomersToCall(abilityA, {
      appCode: "tikluy",
      page: 1,
      limit: 20,
      callCount: ["gt3"]
    });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0922222222");
  });

  test("callCount=['0','gt3'] (multi-select) -> gộp cả 'Chưa gọi' VÀ 'Trên 3 lần', bỏ qua lần 1/2/3", async () => {
    const saleA = await createSale("saleA6", "Sale A6", "NV-A6");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });

    const customer0Calls = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach Chua Goi" }
    });
    const customer2Calls = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0922222222",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach Goi 2 Lan" }
    });
    const customer5Calls = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0933333333",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach Goi 5 Lan" }
    });

    await CustomerCallStatsModel.create({
      customer_id: customer2Calls._id,
      call_count: 2,
      last_contacted_at: new Date()
    });
    await CustomerCallStatsModel.create({
      customer_id: customer5Calls._id,
      call_count: 5,
      last_contacted_at: new Date()
    });

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCustomersToCall(abilityA, {
      appCode: "tikluy",
      page: 1,
      limit: 20,
      callCount: [0, "gt3"]
    });

    expect(result.total).toBe(2);
    const phones = (result.data as any[]).map((item) => item.phone_number).sort();
    expect(phones).toEqual(["0911111111", "0933333333"]);
    expect(customer0Calls).toBeTruthy();
  });

  test("status=['dang_dau_tu','chua_ekyc'] (multi-select) -> gộp 2 nhóm trạng thái", async () => {
    const saleA = await createSale("saleA7", "Sale A7", "NV-A7");
    await seedCustomerCallPermission(saleA.employeeId);
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });

    await CustomerModel.create({
      app_id: app._id,
      phone_number: "0944444444",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach Chua eKYC" }
    });
    const investedCustomer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0955555555",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach Dang Dau Tu", verified_at: new Date() }
    });
    await CustomerModel.create({
      app_id: app._id,
      phone_number: "0966666666",
      referred_by: saleA.employeeId,
      identity: { full_name: "Khach eKYC Chua DT", verified_at: new Date() }
    });
    await InvestmentModel.create({
      app_id: app._id,
      customer_id: investedCustomer._id,
      external_investment_id: "ext-multi-1",
      product_name: "Sản phẩm test",
      amount: 1000000,
      term_type: "month",
      term_value: 6,
      interest_rate: 10,
      invested_at: new Date(),
      maturity_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180),
      status: "active"
    });

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCustomersToCall(abilityA, {
      appCode: "tikluy",
      page: 1,
      limit: 20,
      status: ["dang_dau_tu", "chua_ekyc"]
    });

    expect(result.total).toBe(2);
    const phones = (result.data as any[]).map((item) => item.phone_number).sort();
    expect(phones).toEqual(["0944444444", "0955555555"]);
  });
});
