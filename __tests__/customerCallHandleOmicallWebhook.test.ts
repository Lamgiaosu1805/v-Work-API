import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  handleOmicallWebhook,
  OmicallWebhookPayload
} from "../src/modules/customer-call/application/handle-omicall-webhook.service";
import CallLogModel from "../src/models/CallLogModel";
import CustomerCallStatsModel from "../src/models/CustomerCallStatsModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");

let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  await Promise.all([
    CallLogModel.init(),
    CustomerCallStatsModel.init(),
    SaleOmicallProfileModel.init(),
    CustomerModel.init()
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await Promise.all([
    CallLogModel.deleteMany({}),
    CustomerModel.deleteMany({}),
    AppModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({}),
    CustomerCallStatsModel.deleteMany({})
  ]);
});

function basePayload(overrides: Partial<OmicallWebhookPayload>): OmicallWebhookPayload {
  return {
    transaction_id: `tx-${Math.random()}`,
    call_uuid: `uuid-${Math.random()}`,
    direction: "outbound",
    phone_number: "0979896589",
    sip_user: "100",
    answer_sec: 0,
    bill_sec: 0,
    duration: 6,
    call_out_price: 0,
    time_start_call: 1787888086,
    time_end_call: 1787888091,
    hangup_cause: "ORIGINATOR_CANCEL",
    ...overrides
  };
}

describe("handleOmicallWebhook (integration, MongoMemoryServer)", () => {
  test("time_answer_start=0 (chưa từng trả lời) -> lưu là null, không phải epoch 1970", async () => {
    const payload = basePayload({ time_answer_start: 0 });

    await handleOmicallWebhook(payload);

    const saved = await CallLogModel.findOne({ transaction_id: payload.transaction_id }).lean();
    expect(saved).not.toBeNull();
    expect(saved!.time_answer_start).toBeNull();
  });

  test("time_answer_start có giá trị thật -> lưu đúng Date tương ứng", async () => {
    const payload = basePayload({ time_answer_start: 1787888090 });

    await handleOmicallWebhook(payload);

    const saved = await CallLogModel.findOne({ transaction_id: payload.transaction_id }).lean();
    expect(saved!.time_answer_start).toEqual(new Date(1787888090 * 1000));
  });

  test("SĐT trùng ở 2 app -> gán customer_id đúng theo hotline (đầu số) của app đang gọi, không lấy nhầm app khác", async () => {
    const tikluy = await AppModel.create({
      name: "Tikluy",
      code: "tikluy",
      hotline_numbers: ["842871008617"]
    });
    const vnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });

    await CustomerModel.create({
      app_id: tikluy._id,
      phone_number: "0979896589",
      referred_by: null
    });
    const vnfiteCustomer = await CustomerModel.create({
      app_id: vnfite._id,
      phone_number: "0979896589",
      referred_by: null
    });

    const payload = basePayload({ hotline: "842871008617" });
    await handleOmicallWebhook(payload);

    const saved = await CallLogModel.findOne({ transaction_id: payload.transaction_id }).lean();
    expect(String(saved!.customer_id)).not.toBe(String(vnfiteCustomer._id));
  });

  test("SĐT trùng ở 2 app, hotline chưa cấu hình -> fallback gán theo khách đang thuộc đúng sale gọi", async () => {
    const tikluy = await AppModel.create({ name: "Tikluy", code: "tikluy" });
    const vnfite = await AppModel.create({ name: "Vnfite", code: "vnfite" });

    const otherSaleId = new mongoose.Types.ObjectId().toString();
    await SaleOmicallProfileModel.create({
      sale_id: otherSaleId,
      sip_realm: "realm",
      omicall_extension: "999",
      sip_password: "pass",
      omicall_email: "other@omicall.test"
    });
    const callingSaleId = new mongoose.Types.ObjectId().toString();
    await SaleOmicallProfileModel.create({
      sale_id: callingSaleId,
      sip_realm: "realm",
      omicall_extension: "100",
      sip_password: "pass",
      omicall_email: "calling@omicall.test"
    });

    await CustomerModel.create({
      app_id: tikluy._id,
      phone_number: "0979896589",
      referred_by: otherSaleId
    });
    const vnfiteCustomer = await CustomerModel.create({
      app_id: vnfite._id,
      phone_number: "0979896589",
      referred_by: callingSaleId
    });

    const payload = basePayload({ sip_user: "100" });
    await handleOmicallWebhook(payload);

    const saved = await CallLogModel.findOne({ transaction_id: payload.transaction_id }).lean();
    expect(String(saved!.customer_id)).toBe(String(vnfiteCustomer._id));
  });

  test("tạo CallLog mới + có customer khớp -> tăng CustomerCallStats.callCount", async () => {
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0979896589",
      referred_by: null
    });

    const payload = basePayload({});
    await handleOmicallWebhook(payload);

    const stats = await CustomerCallStatsModel.findOne({ customer_id: customer._id }).lean();
    expect(stats).not.toBeNull();
    expect(stats!.call_count).toBe(1);
  });

  test("webhook gọi lại lần 2 cho CÙNG transaction_id (update CDR) -> KHÔNG tăng thêm callCount", async () => {
    const app = await AppModel.create({ name: "TikLuy", code: "tikluy" });
    const customer = await CustomerModel.create({
      app_id: app._id,
      phone_number: "0979896589",
      referred_by: null
    });

    const payload = basePayload({});
    await handleOmicallWebhook(payload);
    await handleOmicallWebhook({ ...payload, bill_sec: 12, hangup_cause: "NORMAL_CLEARING" });

    const stats = await CustomerCallStatsModel.findOne({ customer_id: customer._id }).lean();
    expect(stats!.call_count).toBe(1);
  });

  test("không khớp được customer nào -> không tạo CustomerCallStats", async () => {
    const payload = basePayload({ phone_number: "0900000000" });
    await handleOmicallWebhook(payload);

    const count = await CustomerCallStatsModel.countDocuments({});
    expect(count).toBe(0);
  });
});
