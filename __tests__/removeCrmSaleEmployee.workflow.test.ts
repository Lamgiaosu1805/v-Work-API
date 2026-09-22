import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { removeCrmSaleEmployee } from "../src/workflows/remove-crm-sale-employee.workflow";
import { OmicallClient } from "../src/utils/omicallClient";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
import CustomerModel from "../src/models/CustomerModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

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
  jest.restoreAllMocks();
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({}),
    CustomerModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
});

async function createSale(username: string, fullName: string, maNv: string, email: string) {
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
  return { account, employeeId: String(userInfo._id) };
}

describe("removeCrmSaleEmployee (integration, MongoMemoryServer)", () => {
  test("gỡ nhân viên -> xoá SaleOmicallProfile local, KHÔNG gọi Omicall, GIỮ NGUYÊN role/email/khách hàng đang phụ trách", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });

    const sale = await createSale("removeSaleA", "Remove Sale A", "NV-REMOVE-A", "a@omicall.test");

    await EmployeePermissionProfileModel.create({
      employeeId: sale.employeeId,
      roleIds: [crmSaleRole._id],
      overrides: []
    });

    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "a@omicall.test"
    });

    const appId = new mongoose.Types.ObjectId();
    const customer = await CustomerModel.create({
      app_id: appId,
      phone_number: "0911111111",
      referred_by: sale.employeeId
    });

    const deleteAgentSpy = jest.spyOn(OmicallClient.prototype, "deleteAgent").mockResolvedValue({});

    await removeCrmSaleEmployee(sale.employeeId);

    expect(deleteAgentSpy).not.toHaveBeenCalled();

    const omicallProfile = await SaleOmicallProfileModel.findOne({
      sale_id: sale.employeeId
    }).lean();
    expect((omicallProfile as any).isDeleted).toBe(true);

    const profile = await EmployeePermissionProfileModel.findOne({
      employeeId: sale.employeeId
    }).lean();
    expect((profile as any).roleIds.map((id: any) => String(id))).toEqual([String(crmSaleRole._id)]);

    const userInfo = await UserInfoModel.findById(sale.employeeId).lean();
    expect((userInfo as any).email).toBe("a@omicall.test");

    const updatedCustomer = await CustomerModel.findById(customer._id).lean();
    expect(String((updatedCustomer as any).referred_by)).toBe(sale.employeeId);
  });

  test("nhân viên chưa có SaleOmicallProfile -> không lỗi, không gọi Omicall", async () => {
    const sale = await createSale("removeSaleC", "Remove Sale C", "NV-REMOVE-C", "c@omicall.test");

    const deleteAgentSpy = jest.spyOn(OmicallClient.prototype, "deleteAgent").mockResolvedValue({});

    await expect(removeCrmSaleEmployee(sale.employeeId)).resolves.toBeUndefined();
    expect(deleteAgentSpy).not.toHaveBeenCalled();
  });
});
