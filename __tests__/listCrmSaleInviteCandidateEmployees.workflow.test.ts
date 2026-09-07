import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { listCrmSaleInviteCandidateEmployees } from "../src/workflows/list-crm-sale-invite-candidate-employees.workflow";
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
  await Promise.all([AccountModel.deleteMany({}), UserInfoModel.deleteMany({})]);
});

async function createEmployee(
  username: string,
  fullName: string,
  maNv: string,
  email: string | null,
  options: { accountDeleted?: boolean; userInfoDeleted?: boolean } = {}
) {
  const account = await AccountModel.create({
    username,
    password: "x",
    isDeleted: options.accountDeleted ?? false
  });
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
    email,
    isDeleted: options.userInfoDeleted ?? false
  });
  return String(userInfo._id);
}

describe("listCrmSaleInviteCandidateEmployees", () => {
  test("trả về mọi nhân viên active, không lọc theo role ABAC — bỏ qua nhân viên/tài khoản đã xoá", async () => {
    const withRoleId = await createEmployee("inviteAllA", "Invite All A", "NV-IA-A", "a@x.test");
    const noRoleId = await createEmployee("inviteAllB", "Invite All B", "NV-IA-B", null);
    await createEmployee("inviteAllC", "Invite All C (deleted account)", "NV-IA-C", "c@x.test", {
      accountDeleted: true
    });
    await createEmployee("inviteAllD", "Invite All D (deleted user_info)", "NV-IA-D", "d@x.test", {
      userInfoDeleted: true
    });

    const result = await listCrmSaleInviteCandidateEmployees();
    const resultIds = result.map((item) => item.employeeId).sort();

    expect(resultIds).toEqual([withRoleId, noRoleId].sort());
    expect(result.find((item) => item.employeeId === noRoleId)?.email).toBeNull();
  });
});
