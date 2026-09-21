import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { reassignSaleCustomers } from "../src/workflows/reassign-sale-customers.workflow";
import CustomerModel from "../src/models/CustomerModel";
import CustomerInteractionModel from "../src/models/CustomerInteractionModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await Promise.all([
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    CustomerModel.deleteMany({}),
    CustomerInteractionModel.deleteMany({})
  ]);
});

async function createSale(username: string, fullName: string, maNv: string, phone: string) {
  const account = await AccountModel.create({ username, password: "x" });
  const userInfo = await UserInfoModel.create({
    full_name: fullName,
    cccd: `${maNv}-cccd`,
    phone_number: phone,
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

describe("reassignSaleCustomers", () => {
  test("chuyển đúng toàn bộ khách hàng của sale cũ sang sale mới, giữ nguyên khách của sale khác", async () => {
    const oldSaleId = await createSale("reassignOldA", "Reassign Old A", "NV-RA-A", "0911111111");
    const newSaleId = await createSale("reassignNewA", "Reassign New A", "NV-RA-B", "0922222222");
    const otherSaleId = await createSale(
      "reassignOtherA",
      "Reassign Other A",
      "NV-RA-C",
      "0933333333"
    );
    const appId = new mongoose.Types.ObjectId();

    const customer1 = await CustomerModel.create({
      app_id: appId,
      phone_number: "0944444444",
      referred_by: oldSaleId,
      source_type: "sale",
      ref_code: "OLD-REF"
    });
    const customer2 = await CustomerModel.create({
      app_id: appId,
      phone_number: "0955555555",
      referred_by: otherSaleId,
      source_type: "sale"
    });

    const count = await reassignSaleCustomers(oldSaleId, newSaleId, "chuyển giao thủ công");
    expect(count).toBe(1);

    const updatedCustomer1 = await CustomerModel.findById(customer1._id).lean();
    expect(String((updatedCustomer1 as any).referred_by)).toBe(newSaleId);
    expect((updatedCustomer1 as any).ref_code).toBe("0922222222-NV-RA-B");
    expect((updatedCustomer1 as any).referred_at).not.toBeNull();

    const updatedCustomer2 = await CustomerModel.findById(customer2._id).lean();
    expect(String((updatedCustomer2 as any).referred_by)).toBe(otherSaleId);

    const interactions = await CustomerInteractionModel.find({ customer_id: customer1._id }).lean();
    expect(interactions).toHaveLength(1);
    expect((interactions[0] as any).type).toBe("reassigned");
    expect((interactions[0] as any).content).toContain("Reassign Old A");
    expect((interactions[0] as any).content).toContain("Reassign New A");
  });

  test("giữ nguyên referred_at cũ nếu khách đã có", async () => {
    const oldSaleId = await createSale("reassignOldB", "Reassign Old B", "NV-RA-D", "0911111112");
    const newSaleId = await createSale("reassignNewB", "Reassign New B", "NV-RA-E", "0922222223");
    const appId = new mongoose.Types.ObjectId();
    const originalReferredAt = new Date("2020-01-01");

    const customer = await CustomerModel.create({
      app_id: appId,
      phone_number: "0966666666",
      referred_by: oldSaleId,
      source_type: "sale",
      referred_at: originalReferredAt
    });

    await reassignSaleCustomers(oldSaleId, newSaleId, "test");

    const updated = await CustomerModel.findById(customer._id).lean();
    expect((updated as any).referred_at.getTime()).toBe(originalReferredAt.getTime());
  });

  test("sale nhận không tồn tại -> NotFoundException, không đổi gì", async () => {
    const oldSaleId = await createSale("reassignOldC", "Reassign Old C", "NV-RA-F", "0911111113");
    const appId = new mongoose.Types.ObjectId();
    const fakeNewSaleId = new mongoose.Types.ObjectId().toString();

    const customer = await CustomerModel.create({
      app_id: appId,
      phone_number: "0977777777",
      referred_by: oldSaleId,
      source_type: "sale"
    });

    await expect(reassignSaleCustomers(oldSaleId, fakeNewSaleId, "test")).rejects.toMatchObject({
      statusCode: 404
    });

    const unchanged = await CustomerModel.findById(customer._id).lean();
    expect(String((unchanged as any).referred_by)).toBe(oldSaleId);
  });

  test("sale cũ không có khách hàng nào -> trả về 0, không lỗi", async () => {
    const oldSaleId = await createSale("reassignOldD", "Reassign Old D", "NV-RA-G", "0911111114");
    const newSaleId = await createSale("reassignNewD", "Reassign New D", "NV-RA-H", "0922222224");

    const count = await reassignSaleCustomers(oldSaleId, newSaleId, "test");
    expect(count).toBe(0);
  });
});
