import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { completeSaleOmicallProfileTransferFromWebhook } from "../src/modules/customer-call/application/complete-sale-omicall-profile-transfer.service";
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

describe("completeSaleOmicallProfileTransferFromWebhook", () => {
  test("status SUCCESS, khớp theo requestId -> chuyển sale_id sang target, status về active", async () => {
    const sourceId = await createEmployee("cbSrcA", "Callback Src A", "NV-CB-A", "src-a@x.test");
    const targetId = await createEmployee("cbTgtA", "Callback Tgt A", "NV-CB-B", "tgt-a@x.test");
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "src-a@x.test",
      status: "transferring",
      pending_transfer_request_id: "req-1",
      pending_transfer_target_sale_id: targetId
    });

    const result = await completeSaleOmicallProfileTransferFromWebhook({
      requestId: "req-1",
      status: "SUCCESS",
      payload: { fullName: "Callback Tgt A", phoneNumber: "0900000000", email: "tgt-a@x.test" }
    });

    expect(result).toEqual({
      outcome: "success",
      sourceEmployeeId: sourceId,
      targetEmployeeId: targetId
    });

    const doc = await SaleOmicallProfileModel.findOne({ omicall_extension: "101" }).lean();
    expect(String((doc as any).sale_id)).toBe(targetId);
    expect((doc as any).status).toBe("active");
    expect((doc as any).omicall_email).toBe("tgt-a@x.test");
    expect((doc as any).pending_transfer_request_id).toBeNull();
    expect((doc as any).pending_transfer_target_sale_id).toBeNull();
  });

  test("status ERROR -> profile về active, sale_id KHÔNG đổi (vẫn thuộc source)", async () => {
    const sourceId = await createEmployee("cbSrcB", "Callback Src B", "NV-CB-C", "src-b@x.test");
    const targetId = await createEmployee("cbTgtB", "Callback Tgt B", "NV-CB-D", "tgt-b@x.test");
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "102",
      sip_password: "pass",
      omicall_email: "src-b@x.test",
      status: "transferring",
      pending_transfer_request_id: "req-2",
      pending_transfer_target_sale_id: targetId
    });

    const result = await completeSaleOmicallProfileTransferFromWebhook({
      requestId: "req-2",
      status: "ERROR",
      payload: { fullName: "Callback Tgt B", phoneNumber: "0900000000", email: "tgt-b@x.test" }
    });

    expect(result).toEqual({ outcome: "failure", sourceEmployeeId: sourceId });

    const doc = await SaleOmicallProfileModel.findOne({ omicall_extension: "102" }).lean();
    expect(String((doc as any).sale_id)).toBe(sourceId);
    expect((doc as any).status).toBe("active");
    expect((doc as any).omicall_email).toBe("src-b@x.test");
  });

  test("requestId không khớp -> fallback khớp theo payload.email của target đang transferring", async () => {
    const sourceId = await createEmployee("cbSrcC", "Callback Src C", "NV-CB-E", "src-c@x.test");
    const targetId = await createEmployee("cbTgtC", "Callback Tgt C", "NV-CB-F", "tgt-c@x.test");
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "103",
      sip_password: "pass",
      omicall_email: "src-c@x.test",
      status: "transferring",
      pending_transfer_request_id: null, // giả lập trường hợp không lấy được requestId lúc submit
      pending_transfer_target_sale_id: targetId
    });

    await completeSaleOmicallProfileTransferFromWebhook({
      requestId: undefined,
      status: "SUCCESS",
      payload: { fullName: "Callback Tgt C", phoneNumber: "0900000000", email: "tgt-c@x.test" }
    });

    const doc = await SaleOmicallProfileModel.findOne({ omicall_extension: "103" }).lean();
    expect(String((doc as any).sale_id)).toBe(targetId);
    expect((doc as any).status).toBe("active");
  });

  test("không tìm thấy giao dịch tương ứng -> trả outcome not_found, không đổi gì", async () => {
    await expect(
      completeSaleOmicallProfileTransferFromWebhook({
        requestId: "req-khong-ton-tai",
        status: "SUCCESS",
        payload: { email: "unknown@x.test" }
      })
    ).resolves.toEqual({ outcome: "not_found" });
  });
});
