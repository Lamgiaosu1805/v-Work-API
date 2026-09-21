import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { assignExtensionOutboundHotline } from "../src/modules/customer-call/application/assign-extension-outbound-hotline.service";
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

describe("assignExtensionOutboundHotline (integration, MongoMemoryServer + mock OmicallClient)", () => {
  test("employee chưa có SaleOmicallProfile -> NotFoundException, không gọi Omicall", async () => {
    const sale = await createSale("assignA", "Assign A", "NV-ASSIGN-A");
    const setSpy = jest.spyOn(OmicallClient.prototype, "setExtensionHotline");

    await expect(assignExtensionOutboundHotline(sale.employeeId, "19001234")).rejects.toThrow(
      NotFoundException
    );

    expect(setSpy).not.toHaveBeenCalled();
  });

  test("gán hotline mới -> gọi setExtensionHotline đúng email/hotline/directions cả 2 chiều, lưu hotline_numbers local (thay thế toàn bộ)", async () => {
    const sale = await createSale("assignD", "Assign D", "NV-ASSIGN-D");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "303",
      sip_password: "pass",
      omicall_email: "d@omicall.test",
      hotline_numbers: ["19009999"]
    });

    const setSpy = jest.spyOn(OmicallClient.prototype, "setExtensionHotline").mockResolvedValue({});

    await assignExtensionOutboundHotline(sale.employeeId, "19001234");

    expect(setSpy).toHaveBeenCalledWith({
      hotline: "19001234",
      userEmail: "d@omicall.test",
      directions: ["outbound", "inbound"]
    });

    const saved = await SaleOmicallProfileModel.findOne({ sale_id: sale.employeeId }).lean();
    expect((saved as any).hotline_numbers).toEqual(["19001234"]);
  });

  test("Omicall setExtensionHotline lỗi -> ném lỗi, KHÔNG cập nhật hotline_numbers local", async () => {
    const sale = await createSale("assignE", "Assign E", "NV-ASSIGN-E");
    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "404",
      sip_password: "pass",
      omicall_email: "e@omicall.test",
      hotline_numbers: ["19009999"]
    });

    jest
      .spyOn(OmicallClient.prototype, "setExtensionHotline")
      .mockRejectedValue(new Error("Omicall lỗi"));

    await expect(assignExtensionOutboundHotline(sale.employeeId, "00000000")).rejects.toThrow(
      "Omicall lỗi"
    );

    const saved = await SaleOmicallProfileModel.findOne({ sale_id: sale.employeeId }).lean();
    expect((saved as any).hotline_numbers).toEqual(["19009999"]);
  });
});
