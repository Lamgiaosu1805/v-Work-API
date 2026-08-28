import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import {
  listCallHistory,
  listCallHistorySaleOptions
} from "../src/modules/customer-call/application/list-call-history.service";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import CallLogModel from "../src/models/CallLogModel";
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

async function seedCallLogPermission(employeeId: string) {
  await PermissionCatalogModel.create({
    code: "call_log.view",
    module: "crm",
    name: "Xem lịch sử cuộc gọi",
    entity: "CallLog",
    actionKind: "READ",
    supportsFieldScope: false,
    validDataScopePolicies: ["CALL_LOG_SELF_ASSIGNED_TEST"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "CALL_LOG_SELF_ASSIGNED_TEST",
    entity: "CallLog",
    label: "Chỉ cuộc gọi của chính mình",
    conditionTree: {
      operator: "AND",
      clauses: [
        {
          left: "resource.sale_id",
          operator: "EQ",
          right: { type: "SUBJECT_REF", path: "subject.userId" }
        }
      ]
    }
  });
  const role = await PermissionRoleModel.create({
    name: "Sale CRM (test)",
    code: "CRM_SALE_CALL_LOG_TEST",
    grants: [
      { permissionCode: "call_log.view", dataScopePolicyCode: "CALL_LOG_SELF_ASSIGNED_TEST" }
    ]
  });
  await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });
}

function baseCallLog(overrides: Record<string, unknown>) {
  return {
    transaction_id: `tx-${Math.random()}`,
    call_uuid: `uuid-${Math.random()}`,
    direction: "outbound",
    phone_number: "0911111111",
    time_start_call: new Date(),
    duration: 100,
    answer_sec: 90,
    bill_sec: 80,
    call_out_price: 1000,
    ...overrides
  };
}

beforeEach(async () => {
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    CallLogModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    AppModel.deleteMany({}),
    CustomerModel.deleteMany({})
  ]);
});

describe("listCallHistory (integration, MongoMemoryServer)", () => {
  test("scope SELF_ASSIGNED khớp đúng qua aggregate với sale_id là ObjectId thật -> chỉ thấy cuộc gọi của mình", async () => {
    const saleA = await createSale("saleCallA", "Sale Call A", "NV-CALL-A");
    const saleB = await createSale("saleCallB", "Sale Call B", "NV-CALL-B");
    await seedCallLogPermission(saleA.employeeId);

    await CallLogModel.create([
      baseCallLog({ sale_id: saleA.employeeId, phone_number: "0911111111" }),
      baseCallLog({ sale_id: saleB.employeeId, phone_number: "0922222222" })
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCallHistory(abilityA, { page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0911111111");
  });

  test("lọc theo appCode qua customer_id -> Customer.app_id, cuộc gọi chưa khớp khách hàng (customer_id null) bị loại", async () => {
    const saleA = await createSale("saleCallC", "Sale Call C", "NV-CALL-C");
    await seedCallLogPermission(saleA.employeeId);

    const appTikluy = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const appVnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });

    const customerTikluy = await CustomerModel.create({
      app_id: appTikluy._id,
      phone_number: "0911111111",
      identity: { full_name: "Khach Tikluy" }
    });
    const customerVnfite = await CustomerModel.create({
      app_id: appVnfite._id,
      phone_number: "0922222222",
      identity: { full_name: "Khach Vnfite" }
    });

    await CallLogModel.create([
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customerTikluy._id,
        phone_number: "0911111111"
      }),
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customerVnfite._id,
        phone_number: "0922222222"
      }),
      baseCallLog({ sale_id: saleA.employeeId, customer_id: null, phone_number: "0933333333" })
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCallHistory(abilityA, { appCode: "tikluy", page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0911111111");
  });

  test("search theo tên khách hàng -> KHÔNG lộ cuộc gọi ngoài scope, không trả về toàn bộ", async () => {
    const saleA = await createSale("saleCallD", "Sale Call D", "NV-CALL-D");
    const saleB = await createSale("saleCallE", "Sale Call E", "NV-CALL-E");
    await seedCallLogPermission(saleA.employeeId);

    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customerA = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      identity: { full_name: "Nguyen Van Mot" }
    });
    const customerB = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0922222222",
      identity: { full_name: "Nguyen Van Hai" }
    });

    await CallLogModel.create([
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customerA._id,
        phone_number: "0911111111"
      }),
      baseCallLog({
        sale_id: saleB.employeeId,
        customer_id: customerB._id,
        phone_number: "0922222222"
      })
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCallHistory(abilityA, { page: 1, limit: 20, search: "Nguyen" });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0911111111");
  });

  test("lọc theo direction -> chỉ trả về đúng chiều gọi", async () => {
    const saleA = await createSale("saleCallF", "Sale Call F", "NV-CALL-F");
    await seedCallLogPermission(saleA.employeeId);

    await CallLogModel.create([
      baseCallLog({ sale_id: saleA.employeeId, direction: "outbound", phone_number: "0911111111" }),
      baseCallLog({ sale_id: saleA.employeeId, direction: "inbound", phone_number: "0922222222" })
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCallHistory(abilityA, { page: 1, limit: 20, direction: "inbound" });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0922222222");
  });
});

describe("listCallHistorySaleOptions (integration, MongoMemoryServer)", () => {
  test("trả về danh sách NV distinct đã có cuộc gọi, đúng theo scope", async () => {
    const saleA = await createSale("saleCallG", "Sale Call G", "NV-CALL-G");
    const saleB = await createSale("saleCallH", "Sale Call H", "NV-CALL-H");
    await seedCallLogPermission(saleA.employeeId);

    await CallLogModel.create([
      baseCallLog({ sale_id: saleA.employeeId, phone_number: "0911111111" }),
      baseCallLog({ sale_id: saleA.employeeId, phone_number: "0911111112" }),
      baseCallLog({ sale_id: saleB.employeeId, phone_number: "0922222222" })
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const options = await listCallHistorySaleOptions(abilityA);

    expect(options).toHaveLength(1);
    expect(options[0].saleName).toBe("Sale Call G");
  });
});
