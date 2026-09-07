import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { transferCrmSaleEmployee } from "../src/workflows/transfer-crm-sale-employee.workflow";
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

describe("transferCrmSaleEmployee", () => {
  test("Omicall trả payload đúng shape -> trả về requestId", async () => {
    const sourceId = await createEmployee(
      "transferSrcA",
      "Transfer Src A",
      "NV-TF-A",
      "src-a@x.test"
    );
    const targetId = await createEmployee(
      "transferTgtA",
      "Transfer Tgt A",
      "NV-TF-B",
      "tgt-a@x.test"
    );
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "src-a@x.test"
    });

    jest
      .spyOn(OmicallClient.prototype, "transferAgent")
      .mockResolvedValue({ requestId: "req-123" });

    const result = await transferCrmSaleEmployee(sourceId, targetId);
    expect(result).toEqual({ requestId: "req-123" });

    const sourceDoc = await SaleOmicallProfileModel.findOne({ sale_id: sourceId }).lean();
    expect((sourceDoc as any).status).toBe("transferring");
    expect((sourceDoc as any).pending_transfer_request_id).toBe("req-123");
    expect(String((sourceDoc as any).pending_transfer_target_sale_id)).toBe(targetId);
  });

  test("Omicall HTTP call thành công nhưng response thiếu requestId -> KHÔNG throw, trả requestId: null", async () => {
    const sourceId = await createEmployee(
      "transferSrcB",
      "Transfer Src B",
      "NV-TF-C",
      "src-b@x.test"
    );
    const targetId = await createEmployee(
      "transferTgtB",
      "Transfer Tgt B",
      "NV-TF-D",
      "tgt-b@x.test"
    );
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "102",
      sip_password: "pass",
      omicall_email: "src-b@x.test"
    });

    // Giả lập response thật của Omicall không đúng shape { payload: { requestId } } đã giả định trước đây —
    // OmicallClient.transferAgent (đã sửa) tự xử lý việc này, không throw nữa.
    jest.spyOn(OmicallClient.prototype, "transferAgent").mockResolvedValue({ requestId: null });

    const result = await transferCrmSaleEmployee(sourceId, targetId);
    expect(result).toEqual({ requestId: null });
  });

  test("Omicall trả lỗi HTTP thật (409) -> ném ConflictException chứa message thật", async () => {
    const sourceId = await createEmployee(
      "transferSrcC",
      "Transfer Src C",
      "NV-TF-E",
      "src-c@x.test"
    );
    const targetId = await createEmployee(
      "transferTgtC",
      "Transfer Tgt C",
      "NV-TF-F",
      "tgt-c@x.test"
    );
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "103",
      sip_password: "pass",
      omicall_email: "src-c@x.test"
    });

    jest.spyOn(OmicallClient.prototype, "transferAgent").mockRejectedValue({
      response: { data: { message: "Email đích đã tồn tại agent khác" } },
      message: "Request failed with status code 409"
    });

    await expect(transferCrmSaleEmployee(sourceId, targetId)).rejects.toMatchObject({
      statusCode: 409,
      message: "Gọi chuyển giao Omicall thất bại: Email đích đã tồn tại agent khác"
    });
  });

  test("target đã có tài khoản Omicall -> ném ArgumentInvalidException, không gọi Omicall", async () => {
    const sourceId = await createEmployee(
      "transferSrcD",
      "Transfer Src D",
      "NV-TF-G",
      "src-d@x.test"
    );
    const targetId = await createEmployee(
      "transferTgtD",
      "Transfer Tgt D",
      "NV-TF-H",
      "tgt-d@x.test"
    );
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "104",
      sip_password: "pass",
      omicall_email: "src-d@x.test"
    });
    await SaleOmicallProfileModel.create({
      sale_id: targetId,
      sip_realm: "realm",
      omicall_extension: "105",
      sip_password: "pass",
      omicall_email: "tgt-d@x.test"
    });

    const transferAgentSpy = jest.spyOn(OmicallClient.prototype, "transferAgent");

    await expect(transferCrmSaleEmployee(sourceId, targetId)).rejects.toMatchObject({
      statusCode: 400
    });
    expect(transferAgentSpy).not.toHaveBeenCalled();
  });

  test("source đang status transferring -> ném ConflictException, không gọi Omicall", async () => {
    const sourceId = await createEmployee(
      "transferSrcE",
      "Transfer Src E",
      "NV-TF-I",
      "src-e@x.test"
    );
    const targetId = await createEmployee(
      "transferTgtE",
      "Transfer Tgt E",
      "NV-TF-J",
      "tgt-e@x.test"
    );
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "106",
      sip_password: "pass",
      omicall_email: "src-e@x.test",
      status: "transferring",
      pending_transfer_request_id: "req-cu",
      pending_transfer_target_sale_id: new mongoose.Types.ObjectId().toString()
    });

    const transferAgentSpy = jest.spyOn(OmicallClient.prototype, "transferAgent");

    await expect(transferCrmSaleEmployee(sourceId, targetId)).rejects.toMatchObject({
      statusCode: 409
    });
    expect(transferAgentSpy).not.toHaveBeenCalled();
  });
});
