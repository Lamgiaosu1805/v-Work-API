import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { setCrmSaleEmployeeEmail } from "../src/workflows/set-crm-sale-employee-email.workflow";
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

async function createEmployee(username: string, fullName: string, maNv: string) {
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
    email: null
  });
  return String(userInfo._id);
}

describe("setCrmSaleEmployeeEmail", () => {
  test("cập nhật email hợp lệ cho nhân viên chưa có email", async () => {
    const employeeId = await createEmployee("emailSaleA", "Email Sale A", "NV-EMAIL-A");

    await setCrmSaleEmployeeEmail(employeeId, "  email-a@vnfite.test  ");

    const userInfo = await UserInfoModel.findById(employeeId).lean();
    expect((userInfo as any).email).toBe("email-a@vnfite.test");
  });

  test("email sai định dạng -> ném ArgumentInvalidException, KHÔNG cập nhật", async () => {
    const employeeId = await createEmployee("emailSaleB", "Email Sale B", "NV-EMAIL-B");

    await expect(setCrmSaleEmployeeEmail(employeeId, "khong-phai-email")).rejects.toMatchObject({
      statusCode: 400
    });

    const userInfo = await UserInfoModel.findById(employeeId).lean();
    expect((userInfo as any).email).toBeNull();
  });

  test("employeeId không tồn tại -> ném NotFoundException", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(setCrmSaleEmployeeEmail(fakeId, "valid@vnfite.test")).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test("email đã được dùng bởi nhân viên khác -> ném ArgumentInvalidException, KHÔNG cập nhật", async () => {
    const employeeAId = await createEmployee("emailSaleC", "Email Sale C", "NV-EMAIL-C");
    const employeeBId = await createEmployee("emailSaleD", "Email Sale D", "NV-EMAIL-D");
    await setCrmSaleEmployeeEmail(employeeAId, "trung@vnfite.test");

    await expect(setCrmSaleEmployeeEmail(employeeBId, "trung@vnfite.test")).rejects.toMatchObject({
      statusCode: 400,
      message: "Email này đã được dùng bởi nhân viên khác (Email Sale C)"
    });

    const userInfoB = await UserInfoModel.findById(employeeBId).lean();
    expect((userInfoB as any).email).toBeNull();
  });

  test("cập nhật lại đúng email hiện tại của chính mình -> không bị coi là trùng", async () => {
    const employeeId = await createEmployee("emailSaleE", "Email Sale E", "NV-EMAIL-E");
    await setCrmSaleEmployeeEmail(employeeId, "email-e@vnfite.test");

    await expect(
      setCrmSaleEmployeeEmail(employeeId, "email-e@vnfite.test")
    ).resolves.toBeUndefined();

    const userInfo = await UserInfoModel.findById(employeeId).lean();
    expect((userInfo as any).email).toBe("email-e@vnfite.test");
  });
});
