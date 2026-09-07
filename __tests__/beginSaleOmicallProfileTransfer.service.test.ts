import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { beginSaleOmicallProfileTransfer } from "../src/modules/customer-call";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";

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
  await SaleOmicallProfileModel.deleteMany({});
});

describe("beginSaleOmicallProfileTransfer", () => {
  test("chuyển profile sang status transferring, lưu requestId + target", async () => {
    const saleId = new mongoose.Types.ObjectId().toString();
    const targetSaleId = new mongoose.Types.ObjectId().toString();
    await SaleOmicallProfileModel.create({
      sale_id: saleId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "src@x.test"
    });

    await beginSaleOmicallProfileTransfer(saleId, "req-abc", targetSaleId);

    const doc = await SaleOmicallProfileModel.findOne({ sale_id: saleId }).lean();
    expect((doc as any).status).toBe("transferring");
    expect((doc as any).pending_transfer_request_id).toBe("req-abc");
    expect(String((doc as any).pending_transfer_target_sale_id)).toBe(targetSaleId);
  });

  test("saleId không có profile -> ném NotFoundException", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await expect(
      beginSaleOmicallProfileTransfer(fakeId, "req-x", new mongoose.Types.ObjectId().toString())
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("profile đã ở status transferring -> ném lỗi, không ghi đè", async () => {
    const saleId = new mongoose.Types.ObjectId().toString();
    const oldTargetId = new mongoose.Types.ObjectId().toString();
    const newTargetId = new mongoose.Types.ObjectId().toString();
    await SaleOmicallProfileModel.create({
      sale_id: saleId,
      sip_realm: "realm",
      omicall_extension: "102",
      sip_password: "pass",
      omicall_email: "src2@x.test",
      status: "transferring",
      pending_transfer_request_id: "req-old",
      pending_transfer_target_sale_id: oldTargetId
    });

    await expect(beginSaleOmicallProfileTransfer(saleId, "req-new", newTargetId)).rejects.toThrow();

    const doc = await SaleOmicallProfileModel.findOne({ sale_id: saleId }).lean();
    expect((doc as any).pending_transfer_request_id).toBe("req-old");
  });
});
