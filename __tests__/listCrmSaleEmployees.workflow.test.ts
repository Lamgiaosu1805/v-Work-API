import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { listCrmSaleEmployees } from "../src/workflows/list-crm-sale-employees.workflow";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
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

describe("listCrmSaleEmployees", () => {
  test("nhân viên có profile status transferring -> transferStatus trả về đúng 'transferring'", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });

    const employeeId = await createEmployee("listEmpA", "List Employee A", "NV-LIST-A", "a@x.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [crmSaleRole._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "108",
      sip_password: "pass",
      omicall_email: "a@x.test",
      status: "transferring",
      pending_transfer_request_id: "req-1",
      pending_transfer_target_sale_id: new mongoose.Types.ObjectId().toString()
    });

    const result = await listCrmSaleEmployees();
    const item = result.find((entry) => entry.employeeId === employeeId);
    expect(item?.transferStatus).toBe("transferring");
  });

  test("nhân viên có profile status active (mặc định) -> transferStatus trả về 'active'", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });

    const employeeId = await createEmployee("listEmpB", "List Employee B", "NV-LIST-B", "b@x.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [crmSaleRole._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "109",
      sip_password: "pass",
      omicall_email: "b@x.test"
    });

    const result = await listCrmSaleEmployees();
    const item = result.find((entry) => entry.employeeId === employeeId);
    expect(item?.transferStatus).toBe("active");
  });
});
