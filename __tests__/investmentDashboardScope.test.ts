import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const InvestmentController = require("../src/controllers/InvestmentController");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const InvestmentModel = require("../src/models/InvestmentModel");
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
// saleC phòng ban 2, chi nhánh 2.
// Mỗi sale có 1 khách, mỗi khách 1 khoản đầu tư: A = 100, B = 200, C = 400, D = 800.
const accounts = {
  A: new mongoose.Types.ObjectId(),
  B: new mongoose.Types.ObjectId(),
  C: new mongoose.Types.ObjectId(),
  D: new mongoose.Types.ObjectId()
};
type SaleKey = keyof typeof accounts;
const sales = {} as Record<SaleKey, mongoose.Types.ObjectId>;
const branches: Record<string, mongoose.Types.ObjectId> = {};

const INVESTMENT_PERMISSIONS = ["investment.view", "investment.leaderboard"];

const INVESTMENT_POLICIES = [
  { code: "INVESTMENT_ALL_COMPANY", conditionTree: null },
  { code: "INVESTMENT_SELF_ASSIGNED", path: "subject.managedCustomerIds" },
  { code: "INVESTMENT_OWN_DEPARTMENT", path: "subject.departmentColleagueCustomerIds" },
  { code: "INVESTMENT_OWN_BRANCH", path: "subject.branchColleagueCustomerIds" }
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

async function grantInvestmentPermission(
  saleKey: SaleKey,
  permissionCode: string,
  policyCode: string
) {
  const role = await PermissionRoleModel.create({
    name: `Investment scope test ${permissionCode} ${policyCode}`,
    code: `INVESTMENT_SCOPE_TEST_${permissionCode}_${policyCode}_${saleKey}`,
    grants: [{ permissionCode, dataScopePolicyCode: policyCode }]
  });
  await EmployeePermissionProfileModel.create({
    employeeId: sales[saleKey],
    roleIds: [role._id],
    overrides: []
  });
}

async function callAs(
  saleKey: SaleKey,
  handler: (req: unknown, res: unknown) => Promise<unknown>,
  query: Record<string, unknown> = {}
) {
  const permissionAbility = await resolveEffectiveAbility(String(sales[saleKey]));
  const req = { query, account: { _id: accounts[saleKey] }, permissionAbility };
  let body: any;
  const res = {
    status: () => res,
    json: (payload: unknown) => {
      body = payload;
      return res;
    }
  };
  await handler(req, res);
  return body;
}

const callSalesChart = (saleKey: SaleKey, query: Record<string, unknown> = {}) =>
  callAs(saleKey, InvestmentController.getSalesChart, { period: "day", ...query });

const callLeaderboard = (saleKey: SaleKey) =>
  callAs(saleKey, InvestmentController.getLeaderboard, { period: "month" });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await PermissionCatalogModel.create(
    INVESTMENT_PERMISSIONS.map((code) => ({
      code,
      module: "crm",
      name: code,
      entity: "Investment",
      actionKind: "READ",
      supportsFieldScope: false,
      validDataScopePolicies: INVESTMENT_POLICIES.map((p) => p.code),
      validFieldScopePolicies: []
    }))
  );
  await DataScopePolicyModel.create(
    INVESTMENT_POLICIES.map((policy) => ({
      code: policy.code,
      entity: "Investment",
      label: policy.code,
      conditionTree: policy.path
        ? {
            operator: "AND",
            clauses: [
              {
                left: "resource.customer_id",
                operator: "IN",
                right: { type: "SUBJECT_REF", path: policy.path }
              }
            ]
          }
        : null
    }))
  );

  const [branch1, branch2] = await BranchModel.create([
    { branch_name: "Chi nhánh 1", branch_code: "CN1" },
    { branch_name: "Chi nhánh 2", branch_code: "CN2" }
  ]);
  branches.one = branch1._id;
  branches.two = branch2._id;

  const [saleA, saleB, saleC, saleD] = await UserInfoModel.create([
    saleInfo(accounts.A, "SCA01", branch1._id),
    saleInfo(accounts.B, "SCB01", branch1._id),
    saleInfo(accounts.C, "SCC01", branch2._id),
    saleInfo(accounts.D, "SCD01", branch1._id)
  ]);
  sales.A = saleA._id;
  sales.B = saleB._id;
  sales.C = saleC._id;
  sales.D = saleD._id;

  const [deptSale, deptOther] = await DepartmentModel.create([
    { department_name: "Phòng Sale 1", department_code: "PS1" },
    { department_name: "Phòng Sale 2", department_code: "PS2" }
  ]);
  const position = new mongoose.Types.ObjectId();
  await UserDepartmentPositionModel.create([
    { user: saleA._id, department: deptSale._id, position },
    { user: saleB._id, department: deptSale._id, position },
    { user: saleC._id, department: deptOther._id, position },
    { user: saleD._id, department: deptOther._id, position }
  ]);

  const appDoc = await AppModel.create({ name: "TikLuy", code: "tikluy-investment-scope-test" });
  const [customerA, customerB, customerC, customerD] = await CustomerModel.create([
    { app_id: appDoc._id, phone_number: "0912000001", referred_by: saleA._id },
    { app_id: appDoc._id, phone_number: "0912000002", referred_by: saleB._id },
    { app_id: appDoc._id, phone_number: "0912000003", referred_by: saleC._id },
    { app_id: appDoc._id, phone_number: "0912000004", referred_by: saleD._id }
  ]);

  const now = new Date();
  const investment = (customerId: unknown, amount: number) => ({
    app_id: appDoc._id,
    customer_id: customerId,
    external_investment_id: `inv-${Math.random()}`,
    product_name: "Gói tháng",
    amount,
    term_type: "month",
    term_value: 1,
    interest_rate: 6,
    invested_at: now,
    maturity_at: new Date(now.getTime() + 30 * 24 * 3600 * 1000)
  });
  await InvestmentModel.create([
    investment(customerA._id, 100),
    investment(customerB._id, 200),
    investment(customerC._id, 400),
    investment(customerD._id, 800)
  ]);
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

describe("GET /investments/sales-chart — mode theo data scope", () => {
  it("INVESTMENT_SELF_ASSIGNED → personal, chỉ khách của mình, không có lọc chi nhánh", async () => {
    await grantInvestmentPermission("A", "investment.view", "INVESTMENT_SELF_ASSIGNED");

    const body = await callSalesChart("A");

    expect(body.mode).toBe("personal");
    expect(body.summary.total_amount).toBe(100);
    expect(body.breakdown).toEqual([]);
    expect(body.branch_options).toEqual([]);
  });

  it("scope không phải toàn công ty thì bỏ qua branch_id", async () => {
    await grantInvestmentPermission("A", "investment.view", "INVESTMENT_SELF_ASSIGNED");

    const body = await callSalesChart("A", { branch_id: String(branches.two) });

    expect(body.mode).toBe("personal");
    expect(body.summary.total_amount).toBe(100);
  });

  it("INVESTMENT_OWN_DEPARTMENT → department, gồm khách của đồng nghiệp cùng phòng ban", async () => {
    await grantInvestmentPermission("A", "investment.view", "INVESTMENT_OWN_DEPARTMENT");

    const body = await callSalesChart("A");

    expect(body.mode).toBe("department");
    expect(body.summary.total_amount).toBe(300);
    expect(body.breakdown.map((row: { amount: number }) => row.amount)).toEqual([200, 100]);
    expect(body.branch_options).toEqual([]);
  });

  it("INVESTMENT_OWN_BRANCH → branch, gồm sale cùng chi nhánh khác phòng ban", async () => {
    await grantInvestmentPermission("A", "investment.view", "INVESTMENT_OWN_BRANCH");

    const body = await callSalesChart("A");

    expect(body.mode).toBe("branch");
    expect(body.summary.total_amount).toBe(1100);
    expect(body.breakdown.map((row: { amount: number }) => row.amount)).toEqual([800, 200, 100]);
    expect(body.branch_options).toEqual([]);
  });

  it("INVESTMENT_OWN_BRANCH thì bỏ qua branch_id của chi nhánh khác", async () => {
    await grantInvestmentPermission("A", "investment.view", "INVESTMENT_OWN_BRANCH");

    const body = await callSalesChart("A", { branch_id: String(branches.two) });

    expect(body.mode).toBe("branch");
    expect(body.summary.total_amount).toBe(1100);
  });

  it("INVESTMENT_ALL_COMPANY → all, trả danh sách chi nhánh để lọc", async () => {
    await grantInvestmentPermission("C", "investment.view", "INVESTMENT_ALL_COMPANY");

    const body = await callSalesChart("C");

    expect(body.mode).toBe("all");
    expect(body.summary.total_amount).toBe(1500);
    expect(body.branch_options.map((b: { branch_name: string }) => b.branch_name).sort()).toEqual([
      "Chi nhánh 1",
      "Chi nhánh 2"
    ]);
  });

  it("INVESTMENT_ALL_COMPANY + branch_id → branch, vẫn giữ danh sách chi nhánh", async () => {
    await grantInvestmentPermission("C", "investment.view", "INVESTMENT_ALL_COMPANY");

    const body = await callSalesChart("C", { branch_id: String(branches.one) });

    expect(body.mode).toBe("branch");
    expect(body.summary.total_amount).toBe(1100);
    expect(body.branch_options).toHaveLength(2);
  });
});

describe("GET /investments/leaderboard — xếp hạng theo data scope", () => {
  const ranking = (body: { leaderboard: { sale_name: string; total_amount: number }[] }) =>
    body.leaderboard.map((row) => [row.sale_name, row.total_amount]);

  it("INVESTMENT_SELF_ASSIGNED → chỉ có chính mình", async () => {
    await grantInvestmentPermission("A", "investment.leaderboard", "INVESTMENT_SELF_ASSIGNED");

    const body = await callLeaderboard("A");

    expect(ranking(body)).toEqual([["Sale SCA01", 100]]);
  });

  it("INVESTMENT_OWN_DEPARTMENT → xếp hạng các sale cùng phòng ban", async () => {
    await grantInvestmentPermission("A", "investment.leaderboard", "INVESTMENT_OWN_DEPARTMENT");

    const body = await callLeaderboard("A");

    expect(ranking(body)).toEqual([
      ["Sale SCB01", 200],
      ["Sale SCA01", 100]
    ]);
  });

  it("INVESTMENT_ALL_COMPANY → xếp hạng toàn công ty", async () => {
    await grantInvestmentPermission("C", "investment.leaderboard", "INVESTMENT_ALL_COMPANY");

    const body = await callLeaderboard("C");

    expect(ranking(body)).toEqual([
      ["Sale SCD01", 800],
      ["Sale SCC01", 400],
      ["Sale SCB01", 200],
      ["Sale SCA01", 100]
    ]);
  });
});
