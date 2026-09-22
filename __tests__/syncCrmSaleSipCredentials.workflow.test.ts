import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { syncCrmSaleSipCredentials } from "../src/workflows/sync-crm-sale-sip-credentials.workflow";
import { OmicallClient } from "../src/utils/omicallClient";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
import { NotFoundException, ArgumentInvalidException } from "../src/core/exceptions/exceptions";
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
  jest.restoreAllMocks();
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    AccountModel.deleteMany({})
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
  return String(userInfo._id);
}

describe("syncCrmSaleSipCredentials (integration, MongoMemoryServer)", () => {
  test("lấy credentials từ agent có sẵn trên Omicall (getExtensionDetail) rồi lưu local — KHÔNG tạo agent mới", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale(
      "syncSaleA",
      "Sync Sale A",
      "NV-SYNC-A",
      "sync-a@omicall.test"
    );
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [crmSaleRole._id],
      overrides: []
    });

    const inviteAgentSpy = jest.spyOn(OmicallClient.prototype, "inviteAgent");
    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({
      pbx_account: { sip_realm: "realm", sip_user: "201", sip_password: "pass201" }
    } as any);

    const credentials = await syncCrmSaleSipCredentials(employeeId);

    expect(inviteAgentSpy).not.toHaveBeenCalled();
    expect(credentials).toEqual({ sipRealm: "realm", sipUser: "201", sipPassword: "pass201" });

    const savedProfile = await SaleOmicallProfileModel.findOne({ sale_id: employeeId }).lean();
    expect((savedProfile as any).omicall_extension).toBe("201");
  });

  test("nhân viên không có role Sale CRM -> NotFoundException", async () => {
    const employeeId = await createSale(
      "syncSaleC",
      "Sync Sale C",
      "NV-SYNC-C",
      "sync-c@omicall.test"
    );

    await expect(syncCrmSaleSipCredentials(employeeId)).rejects.toThrow(NotFoundException);
  });

  test("nhân viên chưa có email -> ArgumentInvalidException, không gọi Omicall", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const account = await AccountModel.create({ username: "syncSaleD", password: "x" });
    const userInfo = await UserInfoModel.create({
      full_name: "Sync Sale D",
      cccd: "NV-SYNC-D-cccd",
      phone_number: "0900000000",
      sex: 1,
      date_of_birth: new Date("1990-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: account._id,
      ma_nv: "NV-SYNC-D",
      employment_type: "fulltime"
    });
    const employeeId = String(userInfo._id);
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [crmSaleRole._id],
      overrides: []
    });

    const inviteAgentSpy = jest.spyOn(OmicallClient.prototype, "inviteAgent");
    const getExtensionDetailSpy = jest.spyOn(OmicallClient.prototype, "getExtensionDetail");

    await expect(syncCrmSaleSipCredentials(employeeId)).rejects.toThrow(ArgumentInvalidException);
    expect(inviteAgentSpy).not.toHaveBeenCalled();
    expect(getExtensionDetailSpy).not.toHaveBeenCalled();
  });
});
