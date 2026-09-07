import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { listCrmSaleCandidateEmployees } from "../src/workflows/list-crm-sale-candidate-employees.workflow";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");

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
    EmployeePermissionProfileModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    AccountModel.deleteMany({})
  ]);
});

async function createEmployee(username: string, fullName: string, maNv: string, email: string) {
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
    employment_type: "fulltime",
    email
  });
  return String(userInfo._id);
}

describe("listCrmSaleCandidateEmployees", () => {
  test("trả về nhân viên có role CRM_SALE/CRM_SALE_MANAGER/CRM_SALE_TEAM_LEAD, bỏ qua role không liên quan", async () => {
    const saleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const managerRole = await PermissionRoleModel.create({
      name: "Sale CRM Manager",
      code: "CRM_SALE_MANAGER",
      grants: []
    });
    const teamLeadRole = await PermissionRoleModel.create({
      name: "Sale CRM Team Lead",
      code: "CRM_SALE_TEAM_LEAD",
      grants: []
    });
    const unrelatedRole = await PermissionRoleModel.create({
      name: "HR nhân viên",
      code: "HRM_STAFF",
      grants: []
    });

    const saleId = await createEmployee(
      "candidateSale",
      "Candidate Sale",
      "NV-CAND-SALE",
      "sale@test.com"
    );
    const managerId = await createEmployee(
      "candidateManager",
      "Candidate Manager",
      "NV-CAND-MGR",
      "manager@test.com"
    );
    const teamLeadId = await createEmployee(
      "candidateTeamLead",
      "Candidate Team Lead",
      "NV-CAND-TL",
      "teamlead@test.com"
    );
    const unrelatedId = await createEmployee(
      "candidateHr",
      "Candidate HR",
      "NV-CAND-HR",
      "hr@test.com"
    );

    await EmployeePermissionProfileModel.create({
      employeeId: saleId,
      roleIds: [saleRole._id],
      overrides: []
    });
    await EmployeePermissionProfileModel.create({
      employeeId: managerId,
      roleIds: [managerRole._id],
      overrides: []
    });
    await EmployeePermissionProfileModel.create({
      employeeId: teamLeadId,
      roleIds: [teamLeadRole._id],
      overrides: []
    });
    await EmployeePermissionProfileModel.create({
      employeeId: unrelatedId,
      roleIds: [unrelatedRole._id],
      overrides: []
    });

    const result = await listCrmSaleCandidateEmployees();

    expect(result.map((item) => item.employeeId).sort()).toEqual(
      [saleId, managerId, teamLeadId].sort()
    );
    expect(result.find((item) => item.employeeId === unrelatedId)).toBeUndefined();
  });

  test("nhân viên có role hợp lệ nhưng đã có SaleOmicallProfile -> bị loại khỏi candidate", async () => {
    const managerRole = await PermissionRoleModel.create({
      name: "Sale CRM Manager",
      code: "CRM_SALE_MANAGER",
      grants: []
    });

    const managerWithAccountId = await createEmployee(
      "candidateMgrHasAcc",
      "Manager Has Account",
      "NV-CAND-MGR-2",
      "mgr-has-acc@test.com"
    );
    const managerWithoutAccountId = await createEmployee(
      "candidateMgrNoAcc",
      "Manager No Account",
      "NV-CAND-MGR-3",
      "mgr-no-acc@test.com"
    );

    await EmployeePermissionProfileModel.create({
      employeeId: managerWithAccountId,
      roleIds: [managerRole._id],
      overrides: []
    });
    await EmployeePermissionProfileModel.create({
      employeeId: managerWithoutAccountId,
      roleIds: [managerRole._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: managerWithAccountId,
      sip_realm: "realm",
      omicall_extension: "102",
      sip_password: "pass",
      omicall_email: "mgr-has-acc@test.com"
    });

    const result = await listCrmSaleCandidateEmployees();

    expect(result.map((item) => item.employeeId)).toEqual([managerWithoutAccountId]);
  });
});
