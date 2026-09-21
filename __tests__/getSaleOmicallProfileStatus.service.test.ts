import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getSaleOmicallProfileStatus } from "../src/modules/customer-call/application/get-sale-omicall-profile-status.service";
import { OmicallClient } from "../src/utils/omicallClient";
import { NotFoundException } from "../src/core/exceptions/exceptions";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
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

async function createSale(username: string, fullName: string, maNv: string) {
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
    employment_type: "fulltime"
  });
  return { account, employeeId: String(userInfo._id) };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([
    SaleOmicallProfileModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
});

describe("getSaleOmicallProfileStatus (integration, MongoMemoryServer + mock OmicallClient)", () => {
  test("chưa có SaleOmicallProfile -> NotFoundException", async () => {
    const sale = await createSale("statusA", "Status A", "NV-STATUS-A");
    await expect(getSaleOmicallProfileStatus(sale.employeeId)).rejects.toThrow(NotFoundException);
  });

  test("extension trên Omicall khớp local -> isSynced true", async () => {
    const sale = await createSale("statusB", "Status B", "NV-STATUS-B");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "b@omicall.test",
      hotline_numbers: ["19001234"]
    });

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({
      extension: "101",
      full_name: "Status B",
      mail: "b@omicall.test",
      uuid: "u1",
      hotlines: ["19001234"],
      pbx_account: { sip_user: "101", sip_password: "pass" }
    } as any);

    const status = await getSaleOmicallProfileStatus(sale.employeeId);
    expect(status.isSynced).toBe(true);
    expect(status.sipPassword).toBe("pass");
    expect(status.hotlineNumbers).toEqual(["19001234"]);
  });

  test("mật khẩu trên Omicall khác local -> isSynced false", async () => {
    const sale = await createSale("statusH", "Status H", "NV-STATUS-H");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "106",
      sip_password: "pass-old",
      omicall_email: "h@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({
      extension: "106",
      full_name: "Status H",
      mail: "h@omicall.test",
      uuid: "u8",
      hotlines: [],
      pbx_account: { sip_user: "106", sip_password: "pass-new" }
    } as any);

    const status = await getSaleOmicallProfileStatus(sale.employeeId);
    expect(status.isSynced).toBe(false);
  });

  test("local đã có hotline nhưng khác với Omicall -> isSynced false", async () => {
    const sale = await createSale("statusC", "Status C", "NV-STATUS-C");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "102",
      sip_password: "pass",
      omicall_email: "c@omicall.test",
      hotline_numbers: ["19001234"]
    });

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({
      extension: "102",
      full_name: "Status C",
      mail: "c@omicall.test",
      uuid: "u2",
      hotlines: ["19009999"],
      pbx_account: { sip_user: "102" }
    } as any);

    const status = await getSaleOmicallProfileStatus(sale.employeeId);
    expect(status.isSynced).toBe(false);
  });

  test("local chưa có hotline (rỗng), Omicall có hotline -> tự backfill vào DB, trả về đúng, isSynced true", async () => {
    const sale = await createSale("statusG", "Status G", "NV-STATUS-G");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "105",
      sip_password: "pass",
      omicall_email: "g@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({
      extension: "105",
      full_name: "Status G",
      mail: "g@omicall.test",
      uuid: "u7",
      hotlines: ["842871008617"],
      pbx_account: { sip_user: "105", sip_password: "pass" }
    } as any);

    const status = await getSaleOmicallProfileStatus(sale.employeeId);
    expect(status.isSynced).toBe(true);
    expect(status.hotlineNumbers).toEqual(["842871008617"]);

    const saved = await SaleOmicallProfileModel.findOne({ sale_id: sale.employeeId }).lean();
    expect((saved as any).hotline_numbers).toEqual(["842871008617"]);
  });

  test("extension trên Omicall khác local -> isSynced false", async () => {
    const sale = await createSale("statusF", "Status F", "NV-STATUS-F");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "102",
      sip_password: "pass",
      omicall_email: "f@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({
      extension: "999",
      full_name: "Status F",
      mail: "f@omicall.test",
      uuid: "u6",
      hotlines: [],
      pbx_account: { sip_user: "999" }
    } as any);

    const status = await getSaleOmicallProfileStatus(sale.employeeId);
    expect(status.isSynced).toBe(false);
  });

  test("Omicall không tìm thấy agent (payload rỗng) -> isSynced false, không throw", async () => {
    const sale = await createSale("statusD", "Status D", "NV-STATUS-D");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "103",
      sip_password: "pass",
      omicall_email: "d@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "getExtensionDetail").mockResolvedValue({} as any);

    const status = await getSaleOmicallProfileStatus(sale.employeeId);
    expect(status.isSynced).toBe(false);
  });

  test("gọi Omicall bị lỗi (network...) -> isSynced false, không throw ra ngoài", async () => {
    const sale = await createSale("statusE", "Status E", "NV-STATUS-E");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "104",
      sip_password: "pass",
      omicall_email: "e@omicall.test"
    });

    jest
      .spyOn(OmicallClient.prototype, "getExtensionDetail")
      .mockRejectedValue(new Error("network"));

    const status = await getSaleOmicallProfileStatus(sale.employeeId);
    expect(status.isSynced).toBe(false);
  });
});
