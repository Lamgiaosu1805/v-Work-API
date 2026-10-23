import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import cron from "node-cron";
import redisMock from "./mocks/redis";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock("node-cron", () => ({ schedule: jest.fn() }));

/* eslint-disable import/first */
import {
  importHandbookDraft,
  measureHandbookPromptTokens,
  recoverStaleHandbookAnswers,
  purgeExpiredHandbookConversations
} from "../src/modules/handbook-assistant";
import { clearPromptArticleCache } from "../src/modules/handbook-assistant/application/prompt-articles.service";
import { runningAnswers } from "../src/modules/handbook-assistant/application/running-answers.registry";
import { canEmployee } from "../src/core/authorization/can-employee";
import * as permissionModule from "../src/modules/permission";
import { NotFoundException } from "../src/core/exceptions/exceptions";
import HandbookVersionModel from "../src/models/HandbookVersionModel";
import HandbookArticleModel from "../src/models/HandbookArticleModel";
import HandbookConversationModel from "../src/models/HandbookConversationModel";
import HandbookMessageModel from "../src/models/HandbookMessageModel";
import HandbookUsageModel from "../src/models/HandbookUsageModel";
import UserInfoModel from "../src/models/UserInfoModel";
import AccountModel from "../src/models/AccountModel";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import sampleManifest from "../scripts/handbook/sample-handbook.manifest.json";
import { grantHandbookAssistantPermission } from "./helpers/grantHandbookAssistantPermission";
/* eslint-enable import/first */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handbookJobs = require("../src/jobs/handbookAssistantJob");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const models: mongoose.Model<any>[] = [
  HandbookVersionModel,
  HandbookArticleModel,
  HandbookConversationModel,
  HandbookMessageModel,
  HandbookUsageModel
];

let replset: MongoMemoryReplSet;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const oid = () => new mongoose.Types.ObjectId();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  await Promise.all(models.map((model) => model.init()));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  redisMock.__store.clear();
  runningAnswers.clear();
  clearPromptArticleCache();
  Object.keys(process.env)
    .filter((key) => key.startsWith("HANDBOOK_"))
    .forEach((key) => delete process.env[key]);
  await Promise.all([
    ...models.map((model) => model.deleteMany({})),
    UserInfoModel.deleteMany({}),
    AccountModel.deleteMany({}),
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({})
  ]);
});

afterEach(() => jest.restoreAllMocks());

async function streamingTurn(options: {
  account: string;
  createdAt: Date;
  quotaDateKey?: string | null;
  content?: string;
}) {
  const conversation = await HandbookConversationModel.create({
    account: options.account,
    title: "t",
    version: oid(),
    turnCount: 1,
    lastMessageAt: options.createdAt
  });
  const assistant = await HandbookMessageModel.create(
    [
      {
        conversation: conversation._id,
        account: options.account,
        seq: 2,
        role: "assistant",
        status: "streaming",
        content: options.content ?? "",
        quotaDateKey: options.quotaDateKey === undefined ? "2026-10-23" : options.quotaDateKey,
        createdAt: options.createdAt
      }
    ],
    { timestamps: false }
  );
  return { conversation, assistant: assistant[0] };
}

describe("recoverStaleHandbookAnswers (cron mỗi phút)", () => {
  const now = new Date("2026-10-23T10:00:00Z");

  it("chốt câu bị bỏ rơi thành AI_UNAVAILABLE, giữ phần chữ đã có và hoàn đúng lượt của ngày đã giữ", async () => {
    const account = oid().toString();
    await HandbookUsageModel.create({ account, dateKey: "2026-10-22", used: 5 });
    await HandbookUsageModel.create({ account, dateKey: "2026-10-23", used: 2 });
    const stale = await streamingTurn({
      account,
      createdAt: new Date(now.getTime() - 10 * MIN),
      quotaDateKey: "2026-10-22",
      content: "dở dang"
    });

    expect(await recoverStaleHandbookAnswers({ now })).toBe(1);

    expect(await HandbookMessageModel.findById(stale.assistant._id).lean()).toMatchObject({
      status: "error",
      errorCode: "AI_UNAVAILABLE",
      content: "dở dang",
      quotaRefunded: true
    });
    expect((await HandbookUsageModel.findOne({ account, dateKey: "2026-10-22" }))?.used).toBe(4);
    expect((await HandbookUsageModel.findOne({ account, dateKey: "2026-10-23" }))?.used).toBe(2);
  });

  it("không đụng tới câu còn trong hạn (kể cả khi deploy chồng lên tiến trình cũ), câu đang chạy ở tiến trình này, hay tin đã xong", async () => {
    const account = oid().toString();
    await HandbookUsageModel.create({ account, dateKey: "2026-10-23", used: 3 });
    // hạn = maxDuration (180s) + 60s đệm = 4 phút
    const fresh = await streamingTurn({ account, createdAt: new Date(now.getTime() - 3 * MIN) });
    const mine = await streamingTurn({ account, createdAt: new Date(now.getTime() - 30 * MIN) });
    runningAnswers.tryClaim({
      messageId: String(mine.assistant._id),
      accountId: account,
      maxConcurrent: 5
    });
    const done = await streamingTurn({ account, createdAt: new Date(now.getTime() - 30 * MIN) });
    await HandbookMessageModel.updateOne({ _id: done.assistant._id }, { $set: { status: "done" } });

    expect(await recoverStaleHandbookAnswers({ now })).toBe(0);

    expect((await HandbookMessageModel.findById(fresh.assistant._id))?.status).toBe("streaming");
    expect((await HandbookMessageModel.findById(mine.assistant._id))?.status).toBe("streaming");
    expect((await HandbookMessageModel.findById(done.assistant._id))?.status).toBe("done");
    expect((await HandbookUsageModel.findOne({ account }))?.used).toBe(3);
  });

  it("idempotent: chạy lại hoặc chạy đồng thời không hoàn lượt 2 lần", async () => {
    const account = oid().toString();
    await HandbookUsageModel.create({ account, dateKey: "2026-10-23", used: 3 });
    await streamingTurn({ account, createdAt: new Date(now.getTime() - 10 * MIN) });

    const counts = await Promise.all([
      recoverStaleHandbookAnswers({ now }),
      recoverStaleHandbookAnswers({ now }),
      recoverStaleHandbookAnswers({ now })
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await recoverStaleHandbookAnswers({ now })).toBe(0);
    expect((await HandbookUsageModel.findOne({ account }))?.used).toBe(2);
  });

  it("tin không có quotaDateKey vẫn được chốt (không hoàn lượt); nhiều tin cùng lúc", async () => {
    const a = oid().toString();
    const b = oid().toString();
    await HandbookUsageModel.create({ account: b, dateKey: "2026-10-23", used: 1 });
    await streamingTurn({
      account: a,
      createdAt: new Date(now.getTime() - 10 * MIN),
      quotaDateKey: null
    });
    await streamingTurn({ account: b, createdAt: new Date(now.getTime() - 20 * MIN) });

    expect(await recoverStaleHandbookAnswers({ now })).toBe(2);
    expect(await HandbookMessageModel.countDocuments({ status: "streaming" })).toBe(0);
    expect((await HandbookUsageModel.findOne({ account: b }))?.used).toBe(0);
    expect(await HandbookUsageModel.findOne({ account: a })).toBeNull();
  });

  it("thời hạn lấy theo HANDBOOK_MAX_DURATION_MS", async () => {
    process.env.HANDBOOK_MAX_DURATION_MS = "600000"; // 10 phút + 1 phút đệm
    const account = oid().toString();
    await streamingTurn({ account, createdAt: new Date(now.getTime() - 10 * MIN) });
    expect(await recoverStaleHandbookAnswers({ now })).toBe(0);
    process.env.HANDBOOK_MAX_DURATION_MS = "60000";
    expect(await recoverStaleHandbookAnswers({ now })).toBe(1);
  });
});

describe("purgeExpiredHandbookConversations (cron 02:00)", () => {
  const now = new Date("2026-10-23T02:00:00Z");

  async function conversationWith(account: string, lastMessageAt: Date, messages = 2) {
    const conversation = await HandbookConversationModel.create({
      account,
      title: "t",
      version: oid(),
      turnCount: 1,
      lastMessageAt
    });
    await HandbookMessageModel.insertMany(
      Array.from({ length: messages }, (_, i) => ({
        conversation: conversation._id,
        account,
        seq: i + 1,
        role: i % 2 === 0 ? "user" : "assistant",
        status: "done",
        content: "x",
        feedback: i % 2 === 1 ? -1 : null,
        feedbackComment: i % 2 === 1 ? "góp ý" : null
      }))
    );
    return conversation;
  }

  it("xoá HẲN hội thoại quá 180 ngày (kèm tin nhắn + đánh giá), giữ hội thoại còn hạn và số liệu dùng theo ngày", async () => {
    const account = oid().toString();
    await HandbookUsageModel.create({ account, dateKey: "2026-04-01", used: 7 });
    const old = await conversationWith(account, new Date(now.getTime() - 181 * DAY));
    const edge = await conversationWith(account, new Date(now.getTime() - 179 * DAY));
    const recent = await conversationWith(account, new Date(now.getTime() - 1 * DAY));

    expect(await purgeExpiredHandbookConversations(now)).toBe(1);

    expect(await HandbookConversationModel.findById(old._id)).toBeNull();
    expect(await HandbookMessageModel.countDocuments({ conversation: old._id })).toBe(0);
    expect(await HandbookConversationModel.findById(edge._id)).not.toBeNull();
    expect(await HandbookConversationModel.findById(recent._id)).not.toBeNull();
    expect(
      await HandbookMessageModel.countDocuments({ conversation: { $in: [edge._id, recent._id] } })
    ).toBe(4);
    expect((await HandbookUsageModel.findOne({ account }))?.used).toBe(7);
  });

  it("thời gian lưu đổi được bằng HANDBOOK_RETENTION_DAYS", async () => {
    process.env.HANDBOOK_RETENTION_DAYS = "30";
    const account = oid().toString();
    const middle = await conversationWith(account, new Date(now.getTime() - 60 * DAY));
    expect(await purgeExpiredHandbookConversations(now)).toBe(1);
    expect(await HandbookConversationModel.findById(middle._id)).toBeNull();
  });

  it("xoá theo từng lô khi có rất nhiều hội thoại quá hạn; chạy lại không còn gì để xoá", async () => {
    const account = oid().toString();
    const version = oid();
    const lastMessageAt = new Date(now.getTime() - 200 * DAY);
    const conversations = await HandbookConversationModel.insertMany(
      Array.from({ length: 450 }, () => ({
        account,
        title: "t",
        version,
        turnCount: 1,
        lastMessageAt
      }))
    );
    await HandbookMessageModel.insertMany(
      conversations.map((c) => ({
        conversation: c._id,
        account,
        seq: 1,
        role: "user",
        status: "done",
        content: "x"
      }))
    );

    expect(await purgeExpiredHandbookConversations(now)).toBe(450);
    expect(await HandbookConversationModel.countDocuments({})).toBe(0);
    expect(await HandbookMessageModel.countDocuments({})).toBe(0);
    expect(await purgeExpiredHandbookConversations(now)).toBe(0);
  });

  it("lỗi giữa chừng: rollback theo lô, không để lại hội thoại cụt tin", async () => {
    const account = oid().toString();
    const old = await conversationWith(account, new Date(now.getTime() - 300 * DAY));
    jest.spyOn(HandbookConversationModel, "deleteMany").mockRejectedValueOnce(new Error("boom"));

    await expect(purgeExpiredHandbookConversations(now)).rejects.toThrow("boom");

    expect(await HandbookConversationModel.findById(old._id)).not.toBeNull();
    expect(await HandbookMessageModel.countDocuments({ conversation: old._id })).toBe(2);
  });
});

describe("measureHandbookPromptTokens", () => {
  async function publishSample() {
    const draft = await importHandbookDraft({ manifest: clone(sampleManifest) as any });
    return draft.versionNo;
  }

  it("đo token của TOÀN BỘ văn bản của phiên bản, lưu vào promptTokens", async () => {
    const versionNo = await publishSample();
    const countPromptTokens = jest.fn().mockResolvedValue(12_345);

    const measured = await measureHandbookPromptTokens(versionNo, { countPromptTokens });

    expect(measured).toEqual({ versionNo, promptTokens: 12_345, exceedsLowPriceTier: false });
    expect(
      countPromptTokens.mock.calls[0][0].map((a: any) => `${a.documentCode}#${a.articleIdx}`)
    ).toEqual([
      "NOI_QUY#7",
      "NOI_QUY#8",
      "NOI_QUY#9",
      "NOI_QUY#12",
      "NOI_QUY#13",
      "BAC_PHAT#1",
      "BAC_PHAT#2"
    ]);
    expect((await HandbookVersionModel.findOne({ versionNo }))?.promptTokens).toBe(12_345);
  });

  it("cảnh báo khi vượt ngưỡng giá thấp 100K token (đúng 100.000 thì chưa)", async () => {
    const versionNo = await publishSample();
    expect(
      (await measureHandbookPromptTokens(versionNo, { countPromptTokens: async () => 100_000 }))
        .exceedsLowPriceTier
    ).toBe(false);
    expect(
      (await measureHandbookPromptTokens(versionNo, { countPromptTokens: async () => 100_001 }))
        .exceedsLowPriceTier
    ).toBe(true);
  });

  it("phiên bản không tồn tại → 404; lỗi của bộ đếm được ném ra và không ghi gì", async () => {
    await expect(
      measureHandbookPromptTokens(99, { countPromptTokens: async () => 1 })
    ).rejects.toBeInstanceOf(NotFoundException);

    const versionNo = await publishSample();
    await expect(
      measureHandbookPromptTokens(versionNo, {
        countPromptTokens: async () => {
          throw new Error("API lỗi");
        }
      })
    ).rejects.toThrow("API lỗi");
    expect((await HandbookVersionModel.findOne({ versionNo }))?.promptTokens).toBeNull();
  });
});

describe("cron job handbookAssistantJob.js", () => {
  it("đăng ký đúng 2 lịch: mỗi phút (quét câu treo) và 02:00 (xoá hội thoại hết hạn)", () => {
    handbookJobs.registerHandbookAssistantJobs();
    const schedules = (cron.schedule as jest.Mock).mock.calls.map((call) => call[0]);
    expect(schedules).toEqual(["* * * * *", "0 2 * * *"]);
  });

  it("job gọi đúng use-case và nuốt lỗi (cron không bao giờ làm sập tiến trình)", async () => {
    // job.js lấy hàm ngay lúc require nên phải dựng lại module với bản giả của use-case
    const recover = jest.fn().mockResolvedValue(0);
    const purge = jest.fn().mockResolvedValue(0);
    let isolated: any;
    jest.isolateModules(() => {
      jest.doMock("../src/modules/handbook-assistant", () => ({
        recoverStaleHandbookAnswers: recover,
        purgeExpiredHandbookConversations: purge
      }));
      // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
      isolated = require("../src/jobs/handbookAssistantJob");
    });

    await isolated.recoverStaleAnswers();
    await isolated.purgeExpiredConversations();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledTimes(1);

    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    recover.mockRejectedValueOnce(new Error("db down"));
    purge.mockRejectedValueOnce(new Error("db down"));
    await expect(isolated.recoverStaleAnswers()).resolves.toBeUndefined();
    await expect(isolated.purgeExpiredConversations()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
    jest.dontMock("../src/modules/handbook-assistant");
  });
});

describe("canEmployee (kiểm tra quyền ngoài Express, dùng cache Redis)", () => {
  let seq = 0;
  async function employee(withPermission: boolean) {
    seq += 1;
    const account = await AccountModel.create({
      username: `ce_${Date.now()}_${seq}`,
      password: "x",
      role: "user"
    });
    const info = await UserInfoModel.create({
      full_name: `NV ${seq}`,
      cccd: `${Date.now()}${seq}`,
      phone_number: "0900000000",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: account._id,
      ma_nv: `CE${Date.now()}${seq}`,
      employment_type: "fulltime"
    });
    if (withPermission) await grantHandbookAssistantPermission(info._id);
    return String(info._id);
  }

  it("true khi có quyền, false khi không có hoặc hỏi quyền/đối tượng khác", async () => {
    const granted = await employee(true);
    const plain = await employee(false);

    expect(await canEmployee(granted, "handbook_assistant.use", "HandbookAssistant")).toBe(true);
    expect(await canEmployee(plain, "handbook_assistant.use", "HandbookAssistant")).toBe(false);
    expect(await canEmployee(granted, "handbook_assistant.use", "Customer")).toBe(false);
    expect(await canEmployee(granted, "employee.view", "Employee")).toBe(false);
  });

  it("dùng chung cache Redis với requirePermission: lần 2 không truy vấn lại quyền; xoá cache thì tính lại", async () => {
    const granted = await employee(true);
    const resolve = jest.spyOn(permissionModule, "resolveEffectiveRules");

    await canEmployee(granted, "handbook_assistant.use", "HandbookAssistant");
    await canEmployee(granted, "handbook_assistant.use", "HandbookAssistant");
    expect(resolve).toHaveBeenCalledTimes(1);

    await EmployeePermissionProfileModel.deleteOne({ employeeId: granted });
    expect(await canEmployee(granted, "handbook_assistant.use", "HandbookAssistant")).toBe(true); // còn cache
    redisMock.__store.clear();
    expect(await canEmployee(granted, "handbook_assistant.use", "HandbookAssistant")).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
