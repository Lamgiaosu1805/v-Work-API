import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { syncHotlineExtensionAssignments } from "../src/modules/customer-call/application/sync-hotline-extension-assignments.service";
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

beforeEach(async () => {
  await Promise.all([
    SaleOmicallProfileModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
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
  return String(userInfo._id);
}

describe("syncHotlineExtensionAssignments (integration, MongoMemoryServer, chỉ ghi DB local, không gọi Omicall)", () => {
  test("gán hotline cho extension có profile -> cập nhật hotline_numbers local", async () => {
    const employeeId = await createSale("hlA", "Hotline A", "NV-HL-A");
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "201",
      sip_password: "pass",
      omicall_email: "a@omicall.test"
    });

    const result = await syncHotlineExtensionAssignments("19001234", ["201"], []);

    expect(result).toEqual({ assigned: ["201"], unassigned: [] });

    const saved = await SaleOmicallProfileModel.findOne({ sale_id: employeeId }).lean();
    expect((saved as any).hotline_numbers).toEqual(["19001234"]);
  });

  test("extension không có profile local -> bỏ qua, không lỗi", async () => {
    const result = await syncHotlineExtensionAssignments("19001234", ["999"], []);
    expect(result).toEqual({ assigned: [], unassigned: [] });
  });

  test("gỡ extension khỏi hotline đang đúng -> xoá hotline_numbers local", async () => {
    const employeeId = await createSale("hlD", "Hotline D", "NV-HL-D");
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "204",
      sip_password: "pass",
      omicall_email: "d@omicall.test",
      hotline_numbers: ["19001234"]
    });

    const result = await syncHotlineExtensionAssignments("19001234", [], ["204"]);

    expect(result.unassigned).toEqual(["204"]);

    const saved = await SaleOmicallProfileModel.findOne({ sale_id: employeeId }).lean();
    expect((saved as any).hotline_numbers).toEqual([]);
  });

  test("gỡ extension nhưng hotline_numbers local đang KHÁC hotline đang gỡ -> giữ nguyên, không tính là unassigned", async () => {
    const employeeId = await createSale("hlE", "Hotline E", "NV-HL-E");
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "205",
      sip_password: "pass",
      omicall_email: "e@omicall.test",
      hotline_numbers: ["19009999"]
    });

    const result = await syncHotlineExtensionAssignments("19001234", [], ["205"]);

    expect(result.unassigned).toEqual([]);

    const saved = await SaleOmicallProfileModel.findOne({ sale_id: employeeId }).lean();
    expect((saved as any).hotline_numbers).toEqual(["19009999"]);
  });
});
