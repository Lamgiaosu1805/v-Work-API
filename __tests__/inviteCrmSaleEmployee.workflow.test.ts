import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { inviteCrmSaleEmployee } from "../src/workflows/invite-crm-sale-employee.workflow";
import { OmicallClient } from "../src/utils/omicallClient";
import { logger } from "../src/config/logger";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
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

describe("inviteCrmSaleEmployee — không gán role khi tạo tài khoản Omicall thất bại", () => {
  test("Omicall inviteAgent lỗi -> ném ConflictException chứa message thật, KHÔNG gán role CRM_SALE", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });

    const employeeId = await createEmployee(
      "inviteEmployeeA",
      "Invite Employee A",
      "NV-INVITE-A",
      "invite-a@omicall.test"
    );

    const omicallError = {
      response: { data: { message: "Email đã được sử dụng bởi 1 agent khác" } },
      message: "Request failed with status code 409"
    };
    jest.spyOn(OmicallClient.prototype, "inviteAgent").mockRejectedValue(omicallError);
    const loggerErrorSpy = jest.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(inviteCrmSaleEmployee(employeeId, "CRM_SALE")).rejects.toMatchObject({
      statusCode: 409,
      message: "Tạo tài khoản Omicall thất bại: Email đã được sử dụng bởi 1 agent khác"
    });

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "Tạo tài khoản Omicall thất bại — chưa gán quyền Sale CRM",
      expect.objectContaining({ omicallErrorMessage: "Email đã được sử dụng bởi 1 agent khác" })
    );

    const profile = await EmployeePermissionProfileModel.findOne({ employeeId }).lean();
    expect(profile).toBeNull();

    const roleStillUnused = await PermissionRoleModel.findById(crmSaleRole._id).lean();
    expect(roleStillUnused).not.toBeNull();
  });
});
