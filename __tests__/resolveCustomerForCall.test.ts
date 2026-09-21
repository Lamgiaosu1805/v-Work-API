import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveCustomerForCall } from "../src/modules/customer-call/application/resolve-customer-for-call";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");

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
  await Promise.all([AppModel.deleteMany({}), CustomerModel.deleteMany({})]);
});

describe("resolveCustomerForCall (integration, MongoMemoryServer)", () => {
  test("chỉ 1 khách trùng SĐT -> trả về luôn, không cần hotline/saleId", async () => {
    const app = await AppModel.create({ name: "Tikluy", code: "tikluy" });
    const customer = await CustomerModel.create({ app_id: app._id, phone_number: "0900000001" });

    const result = await resolveCustomerForCall("0900000001", undefined, null);

    expect(String(result!._id)).toBe(String(customer._id));
  });

  test("2 khách trùng SĐT ở 2 app, hotline khớp app nào -> ưu tiên khách app đó", async () => {
    const tikluy = await AppModel.create({
      name: "Tikluy",
      code: "tikluy",
      hotline_numbers: ["842871008617"]
    });
    const vnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });

    const saleId = new mongoose.Types.ObjectId().toString();
    const tikluyCustomer = await CustomerModel.create({
      app_id: tikluy._id,
      phone_number: "0900000002",
      referred_by: null
    });
    await CustomerModel.create({
      app_id: vnfite._id,
      phone_number: "0900000002",
      referred_by: saleId
    });

    const result = await resolveCustomerForCall("0900000002", "842871008617", saleId);

    expect(String(result!._id)).toBe(String(tikluyCustomer._id));
  });

  test("hotline chưa cấu hình app nào -> fallback theo referred_by khớp sale gọi", async () => {
    const tikluy = await AppModel.create({ name: "Tikluy", code: "tikluy" });
    const vnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });

    const saleId = new mongoose.Types.ObjectId().toString();
    const otherSaleId = new mongoose.Types.ObjectId().toString();
    await CustomerModel.create({
      app_id: tikluy._id,
      phone_number: "0900000003",
      referred_by: otherSaleId
    });
    const vnfiteCustomer = await CustomerModel.create({
      app_id: vnfite._id,
      phone_number: "0900000003",
      referred_by: saleId
    });

    const result = await resolveCustomerForCall("0900000003", undefined, saleId);

    expect(String(result!._id)).toBe(String(vnfiteCustomer._id));
  });

  test("không app/sale nào khớp -> vẫn trả về 1 bản ghi (fallback), không throw", async () => {
    const tikluy = await AppModel.create({ name: "Tikluy", code: "tikluy" });
    const vnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });
    await CustomerModel.create({ app_id: tikluy._id, phone_number: "0900000004" });
    await CustomerModel.create({ app_id: vnfite._id, phone_number: "0900000004" });

    const result = await resolveCustomerForCall(
      "0900000004",
      undefined,
      new mongoose.Types.ObjectId().toString()
    );

    expect(result).not.toBeNull();
  });

  test("không có khách nào trùng SĐT -> null", async () => {
    const result = await resolveCustomerForCall("0900000099", undefined, null);
    expect(result).toBeNull();
  });
});
