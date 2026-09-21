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

// Policy cục bộ khớp đúng semantic thật đang seed (CALL_LOG_SELF_ASSIGNED, quyền xem đi theo
// customer.referred_by hiện tại, không phải theo ai đã thực hiện cuộc gọi).
async function seedCallLogPermission(employeeId: string) {
  const existingCatalog = await PermissionCatalogModel.findOne({ code: "call_log.view" });
  if (!existingCatalog) {
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
  }

  const existingPolicy = await DataScopePolicyModel.findOne({
    code: "CALL_LOG_SELF_ASSIGNED_TEST"
  });
  if (!existingPolicy) {
    await DataScopePolicyModel.create({
      code: "CALL_LOG_SELF_ASSIGNED_TEST",
      entity: "CallLog",
      label: "Chỉ cuộc gọi của khách hàng mình đang phụ trách",
      conditionTree: {
        operator: "AND",
        clauses: [
          {
            left: "resource.customer_id",
            operator: "IN",
            right: { type: "SUBJECT_REF", path: "subject.managedCustomerIds" }
          }
        ]
      }
    });
  }

  let role = await PermissionRoleModel.findOne({ code: "CRM_SALE_CALL_LOG_TEST" });
  if (!role) {
    role = await PermissionRoleModel.create({
      name: "Sale CRM (test)",
      code: "CRM_SALE_CALL_LOG_TEST",
      grants: [
        { permissionCode: "call_log.view", dataScopePolicyCode: "CALL_LOG_SELF_ASSIGNED_TEST" }
      ]
    });
  }
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
  test("chỉ thấy cuộc gọi của khách hàng mình đang phụ trách (theo customer.referred_by hiện tại)", async () => {
    const saleA = await createSale("saleCallA", "Sale Call A", "NV-CALL-A");
    const saleB = await createSale("saleCallB", "Sale Call B", "NV-CALL-B");
    await seedCallLogPermission(saleA.employeeId);

    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customerOfA = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId
    });
    const customerOfB = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0922222222",
      referred_by: saleB.employeeId
    });

    await CallLogModel.create([
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customerOfA._id,
        phone_number: "0911111111"
      }),
      baseCallLog({
        sale_id: saleB.employeeId,
        customer_id: customerOfB._id,
        phone_number: "0922222222"
      })
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const result = await listCallHistory(abilityA, { page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect((result.data[0] as any).phone_number).toBe("0911111111");
  });

  test("chuyển khách hàng sang sale khác -> sale mới xem được cuộc gọi cũ, sale cũ hết thấy", async () => {
    const saleA = await createSale("saleCallReassignA", "Sale Reassign A", "NV-CALL-REA");
    const saleB = await createSale("saleCallReassignB", "Sale Reassign B", "NV-CALL-REB");
    await seedCallLogPermission(saleA.employeeId);
    await seedCallLogPermission(saleB.employeeId);

    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId
    });

    // Cuộc gọi do sale A thực hiện lúc còn phụ trách khách này (sale_id giữ nguyên, không đổi).
    await CallLogModel.create(
      baseCallLog({ sale_id: saleA.employeeId, customer_id: customer._id })
    );

    const abilityABefore = await resolveEffectiveAbility(saleA.employeeId);
    const resultABefore = await listCallHistory(abilityABefore, { page: 1, limit: 20 });
    expect(resultABefore.total).toBe(1);

    // Chuyển khách sang sale B (giống hiệu ứng của reassignSaleCustomers).
    await CustomerModel.updateOne(
      { _id: customer._id },
      { $set: { referred_by: saleB.employeeId } }
    );

    const abilityAAfter = await resolveEffectiveAbility(saleA.employeeId);
    const resultAAfter = await listCallHistory(abilityAAfter, { page: 1, limit: 20 });
    expect(resultAAfter.total).toBe(0);

    const abilityB = await resolveEffectiveAbility(saleB.employeeId);
    const resultB = await listCallHistory(abilityB, { page: 1, limit: 20 });
    expect(resultB.total).toBe(1);
    // sale_id trên bản ghi gốc vẫn là A — vẫn biết chính xác ai đã thực hiện cuộc gọi này.
    expect(String((resultB.data[0] as any).sale_id)).toBe(saleA.employeeId);
  });

  test("lọc theo appCode qua customer_id -> Customer.app_id, cuộc gọi chưa khớp khách hàng (customer_id null) bị loại", async () => {
    const saleA = await createSale("saleCallC", "Sale Call C", "NV-CALL-C");
    await seedCallLogPermission(saleA.employeeId);

    const appTikluy = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const appVnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });

    const customerTikluy = await CustomerModel.create({
      app_id: appTikluy._id,
      phone_number: "0911111111",
      identity: { full_name: "Khach Tikluy" },
      referred_by: saleA.employeeId
    });
    const customerVnfite = await CustomerModel.create({
      app_id: appVnfite._id,
      phone_number: "0922222222",
      identity: { full_name: "Khach Vnfite" },
      referred_by: saleA.employeeId
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
      identity: { full_name: "Nguyen Van Mot" },
      referred_by: saleA.employeeId
    });
    const customerB = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0922222222",
      identity: { full_name: "Nguyen Van Hai" },
      referred_by: saleB.employeeId
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

    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId
    });

    await CallLogModel.create([
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customer._id,
        direction: "outbound",
        phone_number: "0911111111"
      }),
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customer._id,
        direction: "inbound",
        phone_number: "0922222222"
      })
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

    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer1 = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111111",
      referred_by: saleA.employeeId
    });
    const customer2 = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0911111112",
      referred_by: saleA.employeeId
    });
    const customer3 = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0922222222",
      referred_by: saleB.employeeId
    });

    await CallLogModel.create([
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customer1._id,
        phone_number: "0911111111"
      }),
      baseCallLog({
        sale_id: saleA.employeeId,
        customer_id: customer2._id,
        phone_number: "0911111112"
      }),
      baseCallLog({
        sale_id: saleB.employeeId,
        customer_id: customer3._id,
        phone_number: "0922222222"
      })
    ]);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const options = await listCallHistorySaleOptions(abilityA);

    expect(options).toHaveLength(1);
    expect(options[0].saleName).toBe("Sale Call G");
  });
});
