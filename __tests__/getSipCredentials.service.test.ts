import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getSipCredentials } from "../src/modules/customer-call/application/get-sip-credentials.service";
import { OmicallClient } from "../src/utils/omicallClient";
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
  jest.restoreAllMocks();
  await Promise.all([
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({})
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

describe("getSipCredentials", () => {
  test("Omicall trả payload rỗng {} (không có pbx_account) -> ném NotFoundException rõ ràng, không crash", async () => {
    const employeeId = await createEmployee(
      "sipEmpA",
      "Sip Employee A",
      "NV-SIP-A",
      "sip-a@x.test"
    );

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({} as any);

    await expect(getSipCredentials(employeeId, true)).rejects.toMatchObject({
      statusCode: 404,
      message:
        'Không tìm thấy tài khoản Omicall theo email "sip-a@x.test" — kiểm tra lại email nhân viên hoặc tài khoản Omicall đã bị chuyển giao/xoá'
    });
  });

  test("Omicall trả null -> vẫn ném NotFoundException rõ ràng", async () => {
    const employeeId = await createEmployee(
      "sipEmpB",
      "Sip Employee B",
      "NV-SIP-B",
      "sip-b@x.test"
    );

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue(null);

    await expect(getSipCredentials(employeeId, true)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test("Omicall trả đủ pbx_account -> tạo mới SaleOmicallProfile thành công", async () => {
    const employeeId = await createEmployee(
      "sipEmpC",
      "Sip Employee C",
      "NV-SIP-C",
      "sip-c@x.test"
    );

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({
      extension: "110",
      full_name: "Sip Employee C",
      mail: "sip-c@x.test",
      uuid: "uuid-1",
      pbx_account: {
        display_name: "Sip Employee C",
        sip_user: "110",
        sip_password: "pass123",
        sip_web_socket_server: "wss://x",
        sip_realm: "realm-x",
        sip_proxy: "proxy",
        sip_proxy_port: "5060",
        stun_servers: [],
        transport: ["udp"],
        use_opus: true,
        opus_quality: 1
      }
    } as any);

    const result = await getSipCredentials(employeeId, true);
    expect(result).toEqual({ sipRealm: "realm-x", sipUser: "110", sipPassword: "pass123" });
  });
});
