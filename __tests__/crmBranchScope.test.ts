import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import { listCallHistory } from "../src/modules/customer-call/application/list-call-history.service";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import CallLogModel from "../src/models/CallLogModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildCustomerPipeline } = require("../src/helpers/customerHelper");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BranchModel = require("../src/models/BranchModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DepartmentModel = require("../src/models/DepartmentModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserDepartmentPositionModel = require("../src/models/UserDepartmentPositionModel");

let mongod: MongoMemoryServer;

// saleA, saleB cùng phòng ban 1 + chi nhánh 1; saleD phòng ban 2 nhưng cùng chi nhánh 1;
// saleC phòng ban 2, chi nhánh 2. Mỗi sale 1 khách + 1 cuộc gọi; thêm 1 khách chưa có sale.
const accounts = {
  A: new mongoose.Types.ObjectId(),
  B: new mongoose.Types.ObjectId(),
  C: new mongoose.Types.ObjectId(),
  D: new mongoose.Types.ObjectId()
};
type SaleKey = keyof typeof accounts;
const sales = {} as Record<SaleKey, mongoose.Types.ObjectId>;
const customerPhoneBySale = {} as Record<string, string>;
let unassignedPhone = "";

const userRef = (path: string) => ({
  operator: "AND",
  clauses: [{ left: "resource.referred_by", operator: "IN", right: { type: "SUBJECT_REF", path } }]
});
const saleRef = (path: string) => ({
  operator: "AND",
  clauses: [{ left: "resource.sale_id", operator: "IN", right: { type: "SUBJECT_REF", path } }]
});

const POLICIES = [
  { code: "CUSTOMER_ALL_COMPANY", entity: "Customer", conditionTree: null },
  {
    code: "CUSTOMER_SELF_ASSIGNED",
    entity: "Customer",
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
  },
  {
    code: "CUSTOMER_OWN_DEPARTMENT",
    entity: "Customer",
    conditionTree: userRef("subject.departmentColleagueUserIds")
  },
  {
    code: "CUSTOMER_OWN_BRANCH",
    entity: "Customer",
    conditionTree: userRef("subject.branchColleagueUserIds")
  },
  {
    code: "CALL_LOG_OWN_BRANCH",
    entity: "CallLog",
    conditionTree: saleRef("subject.branchColleagueUserIds")
  }
];

const PERMISSIONS = [
  { code: "customer.view", entity: "Customer" },
  { code: "call_log.view", entity: "CallLog" }
];

function saleInfo(idAccount: mongoose.Types.ObjectId, maNv: string, branchId: unknown) {
  return {
    full_name: `Sale ${maNv}`,
    cccd: `${maNv}-cccd`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: idAccount,
    ma_nv: maNv,
    employment_type: "fulltime",
    branch_id: branchId
  };
}

async function grant(saleKey: SaleKey, permissionCode: string, policyCode: string) {
  const role = await PermissionRoleModel.create({
    name: `CRM branch scope test ${permissionCode} ${policyCode}`,
    code: `CRM_BRANCH_SCOPE_TEST_${permissionCode}_${policyCode}_${saleKey}`,
    grants: [{ permissionCode, dataScopePolicyCode: policyCode }]
  });
  await EmployeePermissionProfileModel.create({
    employeeId: sales[saleKey],
    roleIds: [role._id],
    overrides: []
  });
}

async function listCustomerPhones(saleKey: SaleKey, query: Record<string, unknown> = {}) {
  const req = {
    permissionAbility: await resolveEffectiveAbility(String(sales[saleKey])),
    account: { _id: accounts[saleKey] }
  };
  const pipeline = await buildCustomerPipeline(req, query);
  const rows = await CustomerModel.aggregate(pipeline);
  return rows.map((row: { phone_number: string }) => row.phone_number).sort();
}

const phonesOf = (...saleKeys: SaleKey[]) => saleKeys.map((key) => customerPhoneBySale[key]).sort();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await PermissionCatalogModel.create(
    PERMISSIONS.map(({ code, entity }) => ({
      code,
      module: "crm",
      name: code,
      entity,
      actionKind: "READ",
      supportsFieldScope: false,
      validDataScopePolicies: POLICIES.filter((p) => p.entity === entity).map((p) => p.code),
      validFieldScopePolicies: []
    }))
  );
  await DataScopePolicyModel.create(POLICIES.map((policy) => ({ ...policy, label: policy.code })));

  const [branch1, branch2] = await BranchModel.create([
    { branch_name: "Chi nhánh 1", branch_code: "CRMCN1" },
    { branch_name: "Chi nhánh 2", branch_code: "CRMCN2" }
  ]);
  const [saleA, saleB, saleC, saleD] = await UserInfoModel.create([
    saleInfo(accounts.A, "CRA01", branch1._id),
    saleInfo(accounts.B, "CRB01", branch1._id),
    saleInfo(accounts.C, "CRC01", branch2._id),
    saleInfo(accounts.D, "CRD01", branch1._id)
  ]);
  Object.assign(sales, { A: saleA._id, B: saleB._id, C: saleC._id, D: saleD._id });

  const [dept1, dept2] = await DepartmentModel.create([
    { department_name: "Phòng Sale 1", department_code: "CRMPS1" },
    { department_name: "Phòng Sale 2", department_code: "CRMPS2" }
  ]);
  const position = new mongoose.Types.ObjectId();
  await UserDepartmentPositionModel.create([
    { user: saleA._id, department: dept1._id, position },
    { user: saleB._id, department: dept1._id, position },
    { user: saleC._id, department: dept2._id, position },
    { user: saleD._id, department: dept2._id, position }
  ]);

  const appDoc = await AppModel.create({ name: "TikLuy", code: "tikluy-crm-branch-scope-test" });
  const saleKeys: SaleKey[] = ["A", "B", "C", "D"];
  const customers = await CustomerModel.create(
    saleKeys.map((key, index) => ({
      app_id: appDoc._id,
      phone_number: `091300000${index}`,
      referred_by: sales[key]
    }))
  );
  saleKeys.forEach((key, index) => {
    customerPhoneBySale[key] = customers[index].phone_number;
  });
  unassignedPhone = "0913000099";
  await CustomerModel.create({ app_id: appDoc._id, phone_number: unassignedPhone });

  await CallLogModel.create(
    saleKeys.map((key, index) => ({
      transaction_id: `crm-branch-tx-${key}`,
      call_uuid: `crm-branch-uuid-${key}`,
      direction: "outbound",
      phone_number: customers[index].phone_number,
      time_start_call: new Date(),
      sale_id: sales[key],
      customer_id: customers[index]._id
    }))
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({})
  ]);
});

describe("Danh sách khách hàng (/customer/all, export) — lọc theo scope customer.view", () => {
  it("CUSTOMER_SELF_ASSIGNED → chỉ khách của mình", async () => {
    await grant("A", "customer.view", "CUSTOMER_SELF_ASSIGNED");

    expect(await listCustomerPhones("A")).toEqual(phonesOf("A"));
  });

  it("CUSTOMER_OWN_DEPARTMENT → khách của cả phòng ban (trước đây bị coi như của mình)", async () => {
    await grant("A", "customer.view", "CUSTOMER_OWN_DEPARTMENT");

    expect(await listCustomerPhones("A")).toEqual(phonesOf("A", "B"));
  });

  it("CUSTOMER_OWN_BRANCH → khách của mọi sale cùng chi nhánh, không gồm khách chưa có sale", async () => {
    await grant("A", "customer.view", "CUSTOMER_OWN_BRANCH");

    expect(await listCustomerPhones("A")).toEqual(phonesOf("A", "B", "D"));
  });

  it("CUSTOMER_OWN_BRANCH thì lọc sale_ids của chi nhánh khác không mở rộng được scope", async () => {
    await grant("A", "customer.view", "CUSTOMER_OWN_BRANCH");

    expect(await listCustomerPhones("A", { sale_ids: String(sales.C) })).toEqual([]);
  });

  it("CUSTOMER_ALL_COMPANY → toàn bộ khách, kể cả khách chưa có sale", async () => {
    await grant("C", "customer.view", "CUSTOMER_ALL_COMPANY");

    expect(await listCustomerPhones("C")).toEqual(
      [...phonesOf("A", "B", "C", "D"), unassignedPhone].sort()
    );
  });
});

describe("Lịch sử cuộc gọi — CALL_LOG_OWN_BRANCH", () => {
  it("chỉ thấy cuộc gọi của sale cùng chi nhánh", async () => {
    await grant("A", "call_log.view", "CALL_LOG_OWN_BRANCH");

    const ability = await resolveEffectiveAbility(String(sales.A));
    const result = await listCallHistory(ability, { page: 1, limit: 50 } as any);

    const saleIds = (result.data as { sale_id: unknown }[])
      .map((row) => String((row.sale_id as { _id?: unknown })?._id ?? row.sale_id))
      .sort();
    expect(saleIds).toEqual([sales.A, sales.B, sales.D].map(String).sort());
  });
});
