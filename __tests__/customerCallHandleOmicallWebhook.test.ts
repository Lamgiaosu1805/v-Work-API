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
  await Promise.all([CallLogModel.deleteMany({}), CustomerModel.deleteMany({})]);
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
});
