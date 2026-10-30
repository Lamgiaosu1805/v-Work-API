import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import redisMock from "./mocks/redis";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import {
  prepareAsk,
  AskInput
} from "../src/modules/handbook-assistant/application/ask-question.service";
import { cancelAnswer } from "../src/modules/handbook-assistant/application/cancel-answer.service";
import { deleteConversation } from "../src/modules/handbook-assistant/application/delete-conversation.service";
import { shutdownHandbookAssistant } from "../src/modules/handbook-assistant/application/shutdown-handbook-assistant";
import * as quota from "../src/modules/handbook-assistant/application/quota.service";
import { clearPromptArticleCache } from "../src/modules/handbook-assistant/application/prompt-articles.service";
import { runningAnswers } from "../src/modules/handbook-assistant/application/running-answers.registry";
import { acquireBusyLock } from "../src/modules/handbook-assistant/infrastructure/busy-lock";
import { handbookChatRepository } from "../src/modules/handbook-assistant/infrastructure/handbook-chat.repository";
import { HandbookAssistantError } from "../src/modules/handbook-assistant/domain/handbook-assistant.errors";
import { importHandbookDraft, publishHandbookVersion } from "../src/modules/handbook-assistant";
import HandbookVersionModel from "../src/models/HandbookVersionModel";
import HandbookArticleModel from "../src/models/HandbookArticleModel";
import HandbookConversationModel from "../src/models/HandbookConversationModel";
import HandbookMessageModel from "../src/models/HandbookMessageModel";
import HandbookUsageModel from "../src/models/HandbookUsageModel";
import { DateKey } from "../src/shared-kernel/date-key";
import sampleManifest from "../scripts/handbook/sample-handbook.manifest.json";
import {
  FakeAnswerer,
  RecordingEvents,
  controllable,
  createDeps,
  failWith,
  okResult,
  sleep,
  sleepAbortable,
  streamText
} from "./helpers/handbookAssistantFakes";
/* eslint-enable import/first */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const models: mongoose.Model<any>[] = [
  HandbookVersionModel,
  HandbookArticleModel,
  HandbookConversationModel,
  HandbookMessageModel,
  HandbookUsageModel
];

let replset: MongoMemoryReplSet;
let answerer: FakeAnswerer;
let events: RecordingEvents;
let deps: ReturnType<typeof createDeps>;
let seq = 0;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const newAccount = () => new mongoose.Types.ObjectId().toString();
const todayKey = () => DateKey.from(new Date()).toString();

async function publishSample(mutate?: (manifest: any) => void): Promise<number> {
  const manifest: any = clone(sampleManifest);
  mutate?.(manifest);
  const draft = await importHandbookDraft({ manifest });
  await publishHandbookVersion({ versionNo: draft.versionNo });
  return draft.versionNo;
}

function ask(accountId: string, question: string, extra: Partial<AskInput> = {}) {
  seq += 1;
  return prepareAsk(deps, {
    accountId,
    conversationId: null,
    question,
    clientId: `client-${seq}`,
    ...extra
  });
}

async function askAndRun(accountId: string, question: string, extra: Partial<AskInput> = {}) {
  const accepted = await ask(accountId, question, extra);
  await accepted.run();
  return accepted;
}

const message = (id: string) => HandbookMessageModel.findById(id).lean();
const usageOf = async (accountId: string) =>
  HandbookUsageModel.findOne({ account: accountId }).lean();
const codeOf = (error: unknown) => (error as HandbookAssistantError).errorCode;
async function rejection(promise: Promise<unknown>): Promise<HandbookAssistantError> {
  const error = await promise.then(
    () => null,
    (e) => e
  );
  expect(error).toBeInstanceOf(HandbookAssistantError);
  return error as HandbookAssistantError;
}

const ENV_PREFIX = (process.env.BASE_URL ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_");
const lockKey = (accountId: string) => `${ENV_PREFIX}:handbook:busy:${accountId}`;

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
  await Promise.all(models.map((model) => model.deleteMany({})));
  Object.keys(process.env)
    .filter((key) => key.startsWith("HANDBOOK_"))
    .forEach((key) => delete process.env[key]);
  answerer = new FakeAnswerer();
  events = new RecordingEvents();
  deps = createDeps(answerer, events, { acquireBusyLock });
  await publishSample();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("luồng hỏi thành công", () => {
  it("lượt đầu: lưu trước khi ack, stream đúng thứ tự, chốt done kèm citation + chi phí", async () => {
    const account = newAccount();
    answerer.script = streamText(["Theo Điều 12, ", "bạn được nghỉ 12 ngày."], {
      citations: [{ documentIndex: 3, startBlock: 0, endBlock: 1, citedText: "bỏ qua" }]
    });

    const accepted = await ask(account, "  Nghỉ phép năm được mấy ngày?  ");

    // Trạng thái TRƯỚC khi chạy (tức tại thời điểm ack): đã lưu đủ + đã giữ chỗ/khoá/hạn mức
    const conversation = await HandbookConversationModel.findById(accepted.conversationId).lean();
    expect(conversation).toMatchObject({ title: "Nghỉ phép năm được mấy ngày?", turnCount: 1 });
    expect(String(conversation?.account)).toBe(account);
    expect(String(conversation?.version)).toBe(
      String((await HandbookVersionModel.findOne({ status: "active" }))?._id)
    );
    const stored = await HandbookMessageModel.find({ conversation: accepted.conversationId })
      .sort({ seq: 1 })
      .lean();
    expect(stored.map((m) => [m.seq, m.role, m.status, m.content])).toEqual([
      [1, "user", "done", "Nghỉ phép năm được mấy ngày?"],
      [2, "assistant", "streaming", ""]
    ]);
    expect(String(stored[1]._id)).toBe(accepted.messageId);
    expect(stored[0].clientId).toBe(accepted.clientId);
    expect(stored[1].quotaDateKey).toBe(todayKey());
    expect((await usageOf(account))?.used).toBe(1);
    expect(runningAnswers.size).toBe(1);
    expect(redisMock.__store.has(lockKey(account))).toBe(true);
    expect(events.events).toHaveLength(0); // `handbook:start` do tầng socket phát sau ack

    await accepted.run();

    expect(events.of("delta").map((e) => e.payload.text)).toEqual([
      "Theo Điều 12, ",
      "bạn được nghỉ 12 ngày."
    ]);
    const terminal = events.terminal(accepted.messageId);
    expect(terminal).toHaveLength(1);
    expect(terminal[0].type).toBe("done");
    expect(terminal[0].accountId).toBe(account);
    expect(terminal[0].payload).toEqual({
      messageId: accepted.messageId,
      text: "Theo Điều 12, bạn được nghỉ 12 ngày.",
      truncated: false,
      citations: [
        {
          documentCode: "NOI_QUY@1",
          documentTitle: "Nội quy lao động (mẫu)",
          label: "Nội quy – Điều 12",
          articleIdx: 12,
          citedText:
            "1. Người lao động làm việc đủ 12 tháng được nghỉ phép năm 12 ngày làm việc, hưởng nguyên lương."
        }
      ]
    });
    // sự kiện kết thúc đến SAU mọi delta
    expect(events.events.at(-1)?.type).toBe("done");

    const finished = await message(accepted.messageId);
    expect(finished).toMatchObject({
      status: "done",
      content: "Theo Điều 12, bạn được nghỉ 12 ngày.",
      errorCode: null,
      truncated: false,
      quotaRefunded: false
    });
    expect(finished?.citations).toHaveLength(1);
    expect(finished?.ai).toMatchObject({
      model: "claude-haiku-5-5",
      stopReason: "end_turn",
      usage: { input: 1200, output: 80, cacheRead: 0, cacheWrite5m: 10, cacheWrite1h: 1000 }
    });
    expect(finished?.ai?.costUsd).toBeGreaterThan(0);
    expect(finished?.ai?.ttftMs).toBeGreaterThanOrEqual(0);
    expect(finished?.ai?.latencyMs).toBeGreaterThanOrEqual(0);

    // dọn dẹp: slot, khoá busy; số liệu dùng được cộng dồn; hạn mức vẫn là 1 lượt
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
    expect(await usageOf(account)).toMatchObject({
      used: 1,
      inputTokens: 1200,
      outputTokens: 80,
      cacheWriteTokens: 1010
    });
    // AI nhận đúng toàn bộ văn bản theo thứ tự cố định + câu hỏi đã chuẩn hoá
    expect(answerer.calls).toHaveLength(1);
    expect(answerer.calls[0].articles.map((a) => `${a.documentCode}#${a.articleIdx}`)).toEqual([
      "NOI_QUY#7",
      "NOI_QUY#8",
      "NOI_QUY#9",
      "NOI_QUY#12",
      "NOI_QUY#13",
      "BAC_PHAT#1",
      "BAC_PHAT#2"
    ]);
    expect(answerer.calls[0].history).toEqual([]);
    expect(answerer.calls[0].question).toBe("Nghỉ phép năm được mấy ngày?");
  });

  it("lượt tiếp theo trong cùng hội thoại: seq 3/4, turnCount 2, AI nhận lịch sử lượt trước", async () => {
    const account = newAccount();
    answerer.script = streamText(["Câu trả lời 1"]);
    const first = await askAndRun(account, "Câu hỏi 1");
    answerer.script = streamText(["Câu trả lời 2"]);
    const second = await askAndRun(account, "Câu hỏi 2", { conversationId: first.conversationId });

    expect(second.conversationId).toBe(first.conversationId);
    const conversation = await HandbookConversationModel.findById(first.conversationId).lean();
    expect(conversation?.turnCount).toBe(2);
    expect(conversation?.title).toBe("Câu hỏi 1");
    const stored = await HandbookMessageModel.find({ conversation: first.conversationId })
      .sort({ seq: 1 })
      .lean();
    expect(stored.map((m) => [m.seq, m.role, m.status])).toEqual([
      [1, "user", "done"],
      [2, "assistant", "done"],
      [3, "user", "done"],
      [4, "assistant", "done"]
    ]);
    expect(answerer.calls[1].history).toEqual([{ question: "Câu hỏi 1", answer: "Câu trả lời 1" }]);
    expect((await usageOf(account))?.used).toBe(2);
  });

  it("lịch sử bỏ lượt lỗi, giữ lượt tốt (prompt luôn xen kẽ)", async () => {
    const account = newAccount();
    answerer.script = streamText(["A1"]);
    const first = await askAndRun(account, "Q1");
    answerer.script = failWith("overloaded");
    await askAndRun(account, "Q2 lỗi", { conversationId: first.conversationId });
    answerer.script = streamText(["A3"]);
    await askAndRun(account, "Q3", { conversationId: first.conversationId });

    expect(answerer.calls[2].history).toEqual([{ question: "Q1", answer: "A1" }]);
    expect(answerer.calls[2].question).toBe("Q3");
  });

  it("câu hỏi dài đúng 1000 ký tự và có xuống dòng/Unicode tổ hợp được chấp nhận; tiêu đề cắt 80 ký tự", async () => {
    const account = newAccount();
    const long = `${"Đ".repeat(499)}\n${"ê".normalize("NFD").repeat(1)}${"x".repeat(499)}`;
    const accepted = await askAndRun(account, long);
    const conversation = await HandbookConversationModel.findById(accepted.conversationId).lean();
    expect(Array.from(conversation?.title ?? "")).toHaveLength(80);
    expect(conversation?.title).not.toContain("\n");
    expect(answerer.calls[0].question).toBe(long.normalize("NFC").trim());
  });

  it("câu trả lời bị cắt do max_tokens (có chữ) → done kèm truncated", async () => {
    answerer.script = streamText(["Câu trả lời dài bị cắt"], {
      result: { stopReason: "max_tokens" }
    });
    const accepted = await askAndRun(newAccount(), "Hỏi dài");
    expect(events.terminal(accepted.messageId)[0].payload).toMatchObject({ truncated: true });
    expect(await message(accepted.messageId)).toMatchObject({ status: "done", truncated: true });
  });

  it("phiên bản mới publish: hội thoại mới dùng văn bản mới, hội thoại cũ bị khoá, lượt đã trả lời giữ citation đúng bản", async () => {
    const account = newAccount();
    const first = await askAndRun(account, "Q1");
    await publishSample((m) => {
      m.documents[0].articles[0].blocks = ["1. Giờ làm việc mới."];
    });

    expect(
      codeOf(await rejection(ask(account, "Q2", { conversationId: first.conversationId })))
    ).toBe("CONVERSATION_LOCKED");
    await askAndRun(account, "Q3");
    expect(answerer.calls[1].articles[0].blocks).toEqual(["1. Giờ làm việc mới."]);
    expect(answerer.calls[0].articles[0].blocks).not.toEqual(["1. Giờ làm việc mới."]);
  });
});

describe("mã lỗi trước ack — không để lại tác dụng phụ", () => {
  const noSideEffects = async (account: string) => {
    expect(await HandbookConversationModel.countDocuments({})).toBe(0);
    expect(await HandbookMessageModel.countDocuments({})).toBe(0);
    expect(await usageOf(account)).toBeNull();
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
  };

  it("BAD_REQUEST: câu hỏi rỗng / không phải chuỗi / quá 1000 ký tự; clientId thiếu / quá dài", async () => {
    const account = newAccount();
    for (const question of ["", "   \n ", 123, null, undefined, "x".repeat(1001)]) {
      expect(codeOf(await rejection(ask(account, question as string)))).toBe("BAD_REQUEST");
    }
    for (const clientId of ["", "  ", 5, null, undefined, "c".repeat(101)]) {
      expect(codeOf(await rejection(ask(account, "ok", { clientId })))).toBe("BAD_REQUEST");
    }
    await noSideEffects(account);
  });

  it("AI_UNAVAILABLE khi chưa cấu hình AI (không tốn hạn mức)", async () => {
    answerer.configured = false;
    const account = newAccount();
    expect(codeOf(await rejection(ask(account, "Q")))).toBe("AI_UNAVAILABLE");
    await noSideEffects(account);
  });

  it("NO_ACTIVE_HANDBOOK khi chưa có phiên bản hiệu lực", async () => {
    await HandbookVersionModel.updateMany({}, { $set: { status: "archived" } });
    const account = newAccount();
    expect(codeOf(await rejection(ask(account, "Q")))).toBe("NO_ACTIVE_HANDBOOK");
    await noSideEffects(account);
  });

  it("CONVERSATION_LOCKED: id sai định dạng, không tồn tại, của người khác", async () => {
    const owner = newAccount();
    const other = await askAndRun(newAccount(), "Hội thoại của người khác");
    const account = newAccount();
    for (const conversationId of [
      "khong-phai-id",
      "123456789012",
      42,
      "64b000000000000000000099",
      other.conversationId
    ]) {
      const error = await rejection(ask(account, "Q", { conversationId }));
      expect(error.errorCode).toBe("CONVERSATION_LOCKED");
    }
    expect(await HandbookMessageModel.countDocuments({ account })).toBe(0);
    expect(await usageOf(account)).toBeNull();
    expect(owner).toBeTruthy();
  });

  it("TURN_LIMIT khi đạt số lượt tối đa; hội thoại mới vẫn hỏi được", async () => {
    process.env.HANDBOOK_MAX_TURNS = "2";
    const account = newAccount();
    const first = await askAndRun(account, "Q1");
    await askAndRun(account, "Q2", { conversationId: first.conversationId });
    const usedBefore = (await usageOf(account))?.used;

    expect(
      codeOf(await rejection(ask(account, "Q3", { conversationId: first.conversationId })))
    ).toBe("TURN_LIMIT");
    expect((await usageOf(account))?.used).toBe(usedBefore);
    expect((await HandbookConversationModel.findById(first.conversationId))?.turnCount).toBe(2);

    await askAndRun(account, "Q mới");
  });

  it("QUOTA_EXCEEDED khi hết hạn mức trong ngày; slot/khoá được nhả, hội thoại không bị tăng lượt", async () => {
    process.env.HANDBOOK_DAILY_QUOTA = "1";
    const account = newAccount();
    const first = await askAndRun(account, "Q1");

    const error = await rejection(ask(account, "Q2", { conversationId: first.conversationId }));
    expect(error.errorCode).toBe("QUOTA_EXCEEDED");
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
    expect((await HandbookConversationModel.findById(first.conversationId))?.turnCount).toBe(1);
    expect(await HandbookMessageModel.countDocuments({ conversation: first.conversationId })).toBe(
      2
    );
    expect((await usageOf(account))?.used).toBe(1);
  });

  it("thứ tự kiểm tra: NO_ACTIVE_HANDBOOK được báo trước CONVERSATION_LOCKED và QUOTA_EXCEEDED", async () => {
    process.env.HANDBOOK_DAILY_QUOTA = "1";
    const account = newAccount();
    await HandbookVersionModel.updateMany({}, { $set: { status: "archived" } });
    expect(
      codeOf(await rejection(ask(account, "Q", { conversationId: "64b000000000000000000099" })))
    ).toBe("NO_ACTIVE_HANDBOOK");
  });
});

describe("BUSY", () => {
  it("một tài khoản chỉ có 1 câu chạy: hỏi chồng nhận BUSY, hết câu đầu thì hỏi lại được", async () => {
    const account = newAccount();
    const gate = controllable();
    answerer.script = gate.script;
    const first = await ask(account, "Q1");
    const running = first.run();

    const error = await rejection(ask(account, "Q2"));
    expect(error.errorCode).toBe("BUSY");
    expect((await usageOf(account))?.used).toBe(1);
    expect(await HandbookConversationModel.countDocuments({})).toBe(1);

    gate.release();
    await running;
    answerer.script = streamText(["ok"]);
    await askAndRun(account, "Q3");
    expect((await usageOf(account))?.used).toBe(2);
  });

  it("hai yêu cầu ĐỒNG THỜI của một tài khoản: đúng một bên thành công, bên kia BUSY", async () => {
    const account = newAccount();
    const results = await Promise.allSettled([
      ask(account, "A"),
      ask(account, "B"),
      ask(account, "C")
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const busy = results.filter(
      (r) => r.status === "rejected" && (r.reason as HandbookAssistantError).errorCode === "BUSY"
    );
    expect(ok).toHaveLength(1);
    expect(busy).toHaveLength(2);
    expect(await HandbookConversationModel.countDocuments({})).toBe(1);
    expect((await usageOf(account))?.used).toBe(1);
    await (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof ask>>>).value.run();
    expect(runningAnswers.size).toBe(0);
  });

  it("lớp bảo vệ trong tiến trình (registry) tự nó đã chặn hỏi chồng, kể cả khi không có khoá Redis", async () => {
    // acquireBusyLock giả luôn thành công → chỉ còn registry bảo vệ
    deps = createDeps(answerer, events);
    const account = newAccount();
    const gate = controllable();
    answerer.script = gate.script;
    const first = await ask(account, "Q1");
    const running = first.run();

    expect(codeOf(await rejection(ask(account, "Q2")))).toBe("BUSY");
    const concurrent = await Promise.allSettled([
      ask(newAccount(), "A"),
      ask(account, "B"),
      ask(account, "C")
    ]);
    expect(concurrent.filter((r) => r.status === "rejected")).toHaveLength(2);
    expect((await usageOf(account))?.used).toBe(1);

    gate.release();
    await running;
    await Promise.all(
      concurrent
        .filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof ask>>> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value.run())
    );
  });

  it("lớp bảo vệ Redis tự nó đã chặn hỏi chồng giữa hai tiến trình, kể cả khi registry của tiến trình này trống", async () => {
    const account = newAccount();
    const gate = controllable();
    answerer.script = gate.script;
    const first = await ask(account, "Q1");
    const running = first.run();
    // giả lập tiến trình thứ hai: registry riêng, cùng Redis
    const otherProcess = createDeps(answerer, events, {
      acquireBusyLock,
      registry: new (runningAnswers.constructor as any)()
    });
    seq += 1;
    const error = await rejection(
      prepareAsk(otherProcess, {
        accountId: account,
        conversationId: null,
        question: "Q2",
        clientId: `c-${seq}`
      })
    );
    expect(error.errorCode).toBe("BUSY");
    expect((await usageOf(account))?.used).toBe(1);

    gate.release();
    await running;
  });

  it("trần đồng thời toàn server (HANDBOOK_MAX_CONCURRENT)", async () => {
    process.env.HANDBOOK_MAX_CONCURRENT = "1";
    const gate = controllable();
    answerer.script = gate.script;
    const a = newAccount();
    const b = newAccount();
    const running = (await ask(a, "Q")).run();

    const error = await rejection(ask(b, "Q"));
    expect(error.errorCode).toBe("BUSY");
    expect(await usageOf(b)).toBeNull();

    gate.release();
    await running;
    answerer.script = streamText(["ok"]);
    await askAndRun(b, "Q");
  });

  it("khoá Redis do tiến trình khác giữ → BUSY, không tốn hạn mức, không để lại gì", async () => {
    const account = newAccount();
    redisMock.__store.set(lockKey(account), "tien-trinh-khac");

    const error = await rejection(ask(account, "Q"));

    expect(error.errorCode).toBe("BUSY");
    expect(runningAnswers.size).toBe(0);
    expect(await usageOf(account)).toBeNull();
    expect(await HandbookMessageModel.countDocuments({})).toBe(0);
    // khoá của tiến trình khác KHÔNG bị mình xoá
    expect(redisMock.__store.get(lockKey(account))).toBe("tien-trinh-khac");
  });

  it("Redis lỗi thì cho qua (fail-open) vì registry trong tiến trình vẫn bảo vệ", async () => {
    const account = newAccount();
    const failing = jest.spyOn(redisMock, "set").mockRejectedValue(new Error("redis down"));
    const accepted = await askAndRun(account, "Q");
    failing.mockRestore();
    expect(events.terminal(accepted.messageId)[0].type).toBe("done");
  });
});

describe("hạn mức", () => {
  it("reserveQuota nguyên tử: 12 yêu cầu song song, hạn mức 3 → đúng 3 thành công, không lỗi lạ (kể cả đua tạo dòng đầu ngày)", async () => {
    process.env.HANDBOOK_DAILY_QUOTA = "3";
    const account = newAccount();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => quota.reserveQuota(account))
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failures).toHaveLength(9);
    failures.forEach((f) =>
      expect((f.reason as HandbookAssistantError).errorCode).toBe("QUOTA_EXCEEDED")
    );
    expect((await usageOf(account))?.used).toBe(3);
  });

  it("refundQuota trả đúng ngày đã giữ và không bao giờ âm", async () => {
    const account = newAccount();
    await HandbookUsageModel.create({ account, dateKey: "2026-10-22", used: 1 });
    await HandbookUsageModel.create({ account, dateKey: "2026-10-23", used: 4 });
    await quota.refundQuota(account, "2026-10-22");
    await quota.refundQuota(account, "2026-10-22");
    expect((await HandbookUsageModel.findOne({ account, dateKey: "2026-10-22" }))?.used).toBe(0);
    expect((await HandbookUsageModel.findOne({ account, dateKey: "2026-10-23" }))?.used).toBe(4);
  });

  it("hoàn lượt khi lỗi hệ thống, và hoàn TRƯỚC khi phát sự kiện lỗi (web tải lại hạn mức ngay khi nhận sự kiện)", async () => {
    const order: string[] = [];
    const original = quota.refundQuota;
    jest.spyOn(quota, "refundQuota").mockImplementation(async (...args) => {
      order.push("refund");
      return original(...args);
    });
    const error = events.error.bind(events);
    events.error = (accountId, payload) => {
      order.push("error-event");
      error(accountId, payload);
    };
    const account = newAccount();
    answerer.script = failWith("overloaded", ["một phần"]);

    const accepted = await askAndRun(account, "Q");

    expect(order).toEqual(["refund", "error-event"]);
    expect((await usageOf(account))?.used).toBe(0);
    expect(await message(accepted.messageId)).toMatchObject({
      status: "error",
      errorCode: "AI_UNAVAILABLE",
      content: "một phần",
      quotaRefunded: true
    });
  });

  it("chi phí token vẫn được ghi nhận khi lỗi giữa chừng (input đã bị tính tiền)", async () => {
    const account = newAccount();
    answerer.script = failWith("connection");
    const accepted = await askAndRun(account, "Q");
    expect((await message(accepted.messageId))?.ai?.usage).toMatchObject({ input: 1200 });
    expect(await usageOf(account)).toMatchObject({ used: 0, inputTokens: 1200 });
  });
});

describe("từ chối (REFUSED)", () => {
  it("sentinel ở đầu (chia nhiều mảnh): KHÔNG stream chữ nào, hủy stream, lưu REFUSED, vẫn tính lượt", async () => {
    const account = newAccount();
    let aborted = false;
    answerer.script = async (request, callbacks) => {
      callbacks.onTextDelta("[NGOAI_");
      callbacks.onTextDelta("PHAM_VI]");
      try {
        await sleepAbortable(2000, request.signal);
      } catch (error) {
        aborted = true;
        throw error;
      }
      return okResult("[NGOAI_PHAM_VI]");
    };

    const accepted = await askAndRun(account, "Giá vàng hôm nay?");

    expect(aborted).toBe(true);
    expect(events.of("delta")).toHaveLength(0);
    expect(events.terminal(accepted.messageId)).toHaveLength(1);
    expect(events.terminal(accepted.messageId)[0]).toMatchObject({
      type: "error",
      payload: { code: "REFUSED" }
    });
    expect(await message(accepted.messageId)).toMatchObject({
      status: "error",
      errorCode: "REFUSED",
      content: "",
      quotaRefunded: false
    });
    expect((await usageOf(account))?.used).toBe(1);
  });

  it("sentinel bọc markup / có khoảng trắng đầu vẫn bị nhận ra", async () => {
    answerer.script = streamText(["\n**[NGOAI_PHAM_VI]**"]);
    const accepted = await askAndRun(newAccount(), "Q");
    expect(events.of("delta")).toHaveLength(0);
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("REFUSED");
  });

  it("câu trả lời bình thường mở đầu bằng '[' không bị nhầm là từ chối", async () => {
    answerer.script = streamText(["[Nội quy] ", "cho biết 12 ngày."]);
    const accepted = await askAndRun(newAccount(), "Q");
    expect(events.terminal(accepted.messageId)[0].type).toBe("done");
    expect(events.deltaText(accepted.messageId)).toBe("[Nội quy] cho biết 12 ngày.");
  });

  it("bộ lọc an toàn từ chối (stop_reason=refusal): bỏ phần chữ đã sinh, lưu REFUSED rỗng", async () => {
    answerer.script = streamText(["một phần"], { result: { stopReason: "refusal" } });
    const accepted = await askAndRun(newAccount(), "Q");
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("REFUSED");
    expect(await message(accepted.messageId)).toMatchObject({
      status: "error",
      errorCode: "REFUSED",
      content: ""
    });
  });

  it("sentinel xuất hiện giữa câu trả lời thì được gỡ khỏi bản lưu/`done`", async () => {
    answerer.script = streamText(["Trả lời bình thường. ", "[NGOAI_PHAM_VI]", " Hết."]);
    const accepted = await askAndRun(newAccount(), "Q");
    const done = events.terminal(accepted.messageId)[0];
    expect(done.type).toBe("done");
    expect(done.payload.text).toBe("Trả lời bình thường.  Hết.");
    expect((await message(accepted.messageId))?.content).toBe("Trả lời bình thường.  Hết.");
  });

  it("model không trả chữ nào / hết max_tokens khi chưa có chữ → AI_UNAVAILABLE và hoàn lượt", async () => {
    const account = newAccount();
    answerer.script = async () => okResult("", { stopReason: "max_tokens" });
    const accepted = await askAndRun(account, "Q");
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect((await usageOf(account))?.used).toBe(0);
  });
});

describe("hủy (handbook:cancel)", () => {
  it("hủy giữa chừng: dừng AI, lưu phần đã có, phát CANCELLED đúng 1 lần, KHÔNG hoàn lượt, nhả slot/khoá", async () => {
    const account = newAccount();
    const gate = controllable(["Đang ", "trả lời"]);
    answerer.script = gate.script;
    const accepted = await ask(account, "Q");
    const running = accepted.run();
    await gate.hasStarted;

    await cancelAnswer(deps, { accountId: account, messageId: accepted.messageId });
    await running;

    expect(events.terminal(accepted.messageId)).toHaveLength(1);
    expect(events.terminal(accepted.messageId)[0]).toMatchObject({
      type: "error",
      payload: { code: "CANCELLED" }
    });
    expect(await message(accepted.messageId)).toMatchObject({
      status: "cancelled",
      errorCode: "CANCELLED",
      content: "Đang trả lời",
      quotaRefunded: false
    });
    expect((await usageOf(account))?.used).toBe(1);
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
  });

  it("hủy ngay sau ack, TRƯỚC khi chạy: không gọi AI, vẫn phát CANCELLED", async () => {
    const account = newAccount();
    const accepted = await ask(account, "Q");
    await cancelAnswer(deps, { accountId: account, messageId: accepted.messageId });
    await accepted.run();

    expect(answerer.calls).toHaveLength(0);
    expect(events.terminal(accepted.messageId)).toHaveLength(1);
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("CANCELLED");
    expect(await message(accepted.messageId)).toMatchObject({ status: "cancelled", content: "" });
    expect(runningAnswers.size).toBe(0);
  });

  it("người khác / id lạ / id sai định dạng: bỏ qua im lặng, câu trả lời vẫn chạy bình thường", async () => {
    const account = newAccount();
    const gate = controllable();
    answerer.script = gate.script;
    const accepted = await ask(account, "Q");
    const running = accepted.run();
    await gate.hasStarted;

    await cancelAnswer(deps, { accountId: newAccount(), messageId: accepted.messageId });
    await cancelAnswer(deps, { accountId: account, messageId: "64b000000000000000000099" });
    for (const messageId of ["abc", 123, null, undefined, {}]) {
      await cancelAnswer(deps, { accountId: account, messageId });
    }
    expect(runningAnswers.get(accepted.messageId)?.controller.signal.aborted).toBe(false);

    gate.release();
    await running;
    expect(events.terminal(accepted.messageId)[0].type).toBe("done");
  });

  it("tin mồ côi (còn streaming trong DB nhưng không còn trong registry): chủ sở hữu hủy được và web nhận CANCELLED", async () => {
    const account = newAccount();
    const conversation = await HandbookConversationModel.create({
      account,
      title: "mồ côi",
      version: new mongoose.Types.ObjectId(),
      turnCount: 1,
      lastMessageAt: new Date()
    });
    const orphan = await HandbookMessageModel.create({
      conversation: conversation._id,
      account,
      seq: 2,
      role: "assistant",
      status: "streaming",
      content: "dở dang"
    });

    await cancelAnswer(deps, { accountId: newAccount(), messageId: String(orphan._id) });
    expect(events.events).toHaveLength(0);
    expect((await message(String(orphan._id)))?.status).toBe("streaming");

    await cancelAnswer(deps, { accountId: account, messageId: String(orphan._id) });
    expect(events.terminal(String(orphan._id))[0]).toMatchObject({
      type: "error",
      payload: { code: "CANCELLED" }
    });
    expect(await message(String(orphan._id))).toMatchObject({
      status: "cancelled",
      content: "dở dang"
    });

    await cancelAnswer(deps, { accountId: account, messageId: String(orphan._id) });
    expect(events.terminal(String(orphan._id))).toHaveLength(1);
  });

  it("đua giữa hủy và hoàn tất (20 lần với độ trễ khác nhau): luôn đúng 1 sự kiện kết thúc, khớp với DB", async () => {
    const currentDeps = deps;
    const raceOnce = async (i: number) => {
      const account = newAccount();
      answerer.script = streamText(["x", "y"], { delayMs: 2 });
      const accepted = await ask(account, `Q${i}`);
      const cancelLater = sleep(i % 6).then(() =>
        cancelAnswer(currentDeps, { accountId: account, messageId: accepted.messageId })
      );
      await Promise.all([accepted.run(), cancelLater]);
      return accepted;
    };
    for (let i = 0; i < 20; i += 1) {
      const accepted = await raceOnce(i);

      const terminal = events.terminal(accepted.messageId);
      expect(terminal).toHaveLength(1);
      const stored = await message(accepted.messageId);
      expect(stored?.status).toBe(terminal[0].type === "done" ? "done" : "cancelled");
      expect(runningAnswers.size).toBe(0);
    }
  });
});

describe("đồng hồ canh (watchdog) và lỗi AI", () => {
  it("không có sự kiện nào quá hạn idle → AI_UNAVAILABLE, giữ phần đã stream, hoàn lượt", async () => {
    process.env.HANDBOOK_STREAM_IDLE_MS = "80";
    const account = newAccount();
    answerer.script = async (request, callbacks) => {
      callbacks.onActivity();
      callbacks.onTextDelta("Chữ đầu");
      await sleepAbortable(5000, request.signal);
      return okResult("không bao giờ tới");
    };

    const accepted = await askAndRun(account, "Q");

    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect(await message(accepted.messageId)).toMatchObject({
      status: "error",
      content: "Chữ đầu",
      quotaRefunded: true
    });
    expect((await usageOf(account))?.used).toBe(0);
  });

  it("sự kiện hoạt động (ping/thinking) làm mới idle: chạy lâu hơn idle vẫn thành công", async () => {
    process.env.HANDBOOK_STREAM_IDLE_MS = "100";
    answerer.script = async (request, callbacks) => {
      for (let i = 0; i < 8; i += 1) {
        await sleepAbortable(40, request.signal);
        callbacks.onActivity();
      }
      callbacks.onTextDelta("Xong");
      return okResult("Xong");
    };
    const accepted = await askAndRun(newAccount(), "Q");
    expect(events.terminal(accepted.messageId)[0].type).toBe("done");
  });

  it("quá hạn chữ đầu tiên (chỉ có ping) → AI_UNAVAILABLE", async () => {
    process.env.HANDBOOK_FIRST_TEXT_MS = "100";
    process.env.HANDBOOK_STREAM_IDLE_MS = "10000";
    answerer.script = async (request, callbacks) => {
      for (;;) {
        await sleepAbortable(20, request.signal);
        callbacks.onActivity();
      }
    };
    const accepted = await askAndRun(newAccount(), "Q");
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect(events.of("delta")).toHaveLength(0);
  });

  it("vượt tổng thời gian tối đa dù vẫn đang có chữ → AI_UNAVAILABLE", async () => {
    process.env.HANDBOOK_MAX_DURATION_MS = "150";
    answerer.script = async (request, callbacks) => {
      for (;;) {
        await sleepAbortable(20, request.signal);
        callbacks.onActivity();
        callbacks.onTextDelta(".");
      }
    };
    const accepted = await askAndRun(newAccount(), "Q");
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect((await message(accepted.messageId))?.content.length).toBeGreaterThan(0);
  });

  it.each([
    "rate_limited",
    "overloaded",
    "timeout",
    "connection",
    "auth",
    "bad_request",
    "unknown"
  ] as const)("lỗi AI (%s) → AI_UNAVAILABLE + hoàn lượt", async (kind) => {
    const account = newAccount();
    answerer.script = failWith(kind);
    const accepted = await askAndRun(account, "Q");
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect((await usageOf(account))?.used).toBe(0);
  });

  it("lỗi không lường trước (không phải AnswerFailure) cũng quy về AI_UNAVAILABLE, run() không ném", async () => {
    answerer.script = async () => {
      throw new TypeError("bất ngờ");
    };
    const accepted = await ask(newAccount(), "Q");
    await expect(accepted.run()).resolves.toBeUndefined();
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect(runningAnswers.size).toBe(0);
  });

  it("không chốt được vào DB: vẫn báo AI_UNAVAILABLE cho web và nhả slot/khoá (cron sẽ quét tin còn streaming)", async () => {
    const account = newAccount();
    jest.spyOn(handbookChatRepository, "finishAnswer").mockRejectedValueOnce(new Error("db down"));
    const accepted = await ask(account, "Q");
    await expect(accepted.run()).resolves.toBeUndefined();

    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
    expect((await message(accepted.messageId))?.status).toBe("streaming");
  });

  it("lỗi khi gửi sự kiện socket không làm hỏng việc lưu kết quả", async () => {
    events.delta = () => {
      throw new Error("socket lỗi");
    };
    answerer.script = streamText(["a", "b"]);
    const accepted = await askAndRun(newAccount(), "Q");
    expect((await message(accepted.messageId))?.status).toBe("done");
  });
});

describe("lỗi hạ tầng trước ack", () => {
  it("lưu thất bại: hoàn tác hoàn toàn (không còn hội thoại/tin), hoàn lượt, nhả slot/khoá, báo AI_UNAVAILABLE", async () => {
    const account = newAccount();
    jest
      .spyOn(handbookChatRepository, "insertTurnMessages")
      .mockRejectedValueOnce(new Error("db lỗi"));

    expect(codeOf(await rejection(ask(account, "Q")))).toBe("AI_UNAVAILABLE");

    expect(await HandbookConversationModel.countDocuments({})).toBe(0);
    expect(await HandbookMessageModel.countDocuments({})).toBe(0);
    expect((await usageOf(account))?.used).toBe(0);
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
    answerer.script = streamText(["ok"]);
    await askAndRun(account, "Q lại"); // hỏi lại được ngay
  });

  it("xử lý trước ack quá hạn: huỷ hẳn lượt (tin chốt lỗi, hoàn lượt) thay vì ack muộn", async () => {
    process.env.HANDBOOK_ACK_DEADLINE_MS = "40";
    const account = newAccount();
    const original = handbookChatRepository.insertTurnMessages.bind(handbookChatRepository);
    jest.spyOn(handbookChatRepository, "insertTurnMessages").mockImplementation(async (input) => {
      await sleep(150);
      return original(input);
    });

    expect(codeOf(await rejection(ask(account, "Q")))).toBe("AI_UNAVAILABLE");

    expect(await HandbookMessageModel.countDocuments({ status: "streaming" })).toBe(0);
    const assistant = await HandbookMessageModel.findOne({ role: "assistant" }).lean();
    expect(assistant).toMatchObject({
      status: "error",
      errorCode: "AI_UNAVAILABLE",
      quotaRefunded: true
    });
    expect((await usageOf(account))?.used).toBe(0);
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
    expect(answerer.calls).toHaveLength(0);
  });

  it("đua tăng lượt: hội thoại bị khoá/đạt lượt giữa lúc kiểm tra và lúc ghi vẫn trả đúng mã", async () => {
    process.env.HANDBOOK_MAX_TURNS = "1";
    const account = newAccount();
    const first = await askAndRun(account, "Q1");
    // bỏ qua kiểm tra sớm bằng cách làm cho nó thấy turnCount còn trống rồi mới tăng lên đạt trần
    const original = handbookChatRepository.findOwnedConversation.bind(handbookChatRepository);
    let calls = 0;
    jest
      .spyOn(handbookChatRepository, "findOwnedConversation")
      .mockImplementation(async (id, acc) => {
        const found = await original(id, acc);
        calls += 1;
        return calls === 1 && found ? { ...found, turnCount: 0 } : found;
      });

    expect(
      codeOf(await rejection(ask(account, "Q2", { conversationId: first.conversationId })))
    ).toBe("TURN_LIMIT");
    expect((await HandbookConversationModel.findById(first.conversationId))?.turnCount).toBe(1);
    expect(await HandbookMessageModel.countDocuments({ conversation: first.conversationId })).toBe(
      2
    );
    expect((await usageOf(account))?.used).toBe(1);
  });
});

describe("gửi trùng clientId (idempotent)", () => {
  it("trùng khi câu trả lời đang chạy: trả đúng messageId cũ, không tạo lượt/hạn mức mới; replay không phát gì", async () => {
    const account = newAccount();
    const gate = controllable();
    answerer.script = gate.script;
    const first = await ask(account, "Q", { clientId: "cid-1" });
    const running = first.run();

    const again = await ask(account, "Q", { clientId: "cid-1" });
    expect(again.messageId).toBe(first.messageId);
    expect(again.conversationId).toBe(first.conversationId);
    await again.run();
    expect(events.terminal(first.messageId)).toHaveLength(0);
    expect(await HandbookMessageModel.countDocuments({})).toBe(2);
    expect((await usageOf(account))?.used).toBe(1);

    gate.release();
    await running;
  });

  it("trùng sau khi đã xong: phát lại sự kiện kết thúc để web không treo", async () => {
    const account = newAccount();
    answerer.script = streamText(["Xong rồi"]);
    const first = await askAndRun(account, "Q", { clientId: "cid-2" });
    events.events.length = 0;

    const again = await ask(account, "Q", { clientId: "cid-2" });
    await again.run();

    expect(again.messageId).toBe(first.messageId);
    expect(events.terminal(first.messageId)).toHaveLength(1);
    expect(events.terminal(first.messageId)[0]).toMatchObject({
      type: "done",
      payload: { text: "Xong rồi", truncated: false }
    });
    expect((await usageOf(account))?.used).toBe(1);
  });

  it("trùng sau khi lỗi: phát lại đúng mã lỗi", async () => {
    answerer.script = failWith("overloaded");
    const account = newAccount();
    const first = await askAndRun(account, "Q", { clientId: "cid-3" });
    events.events.length = 0;
    await (await ask(account, "Q", { clientId: "cid-3" })).run();
    expect(events.terminal(first.messageId)[0]).toMatchObject({
      type: "error",
      payload: { code: "AI_UNAVAILABLE" }
    });
  });

  it("cùng clientId nhưng KHÁC tài khoản là hai lượt hỏi độc lập", async () => {
    const a = await askAndRun(newAccount(), "Q", { clientId: "chung" });
    const b = await askAndRun(newAccount(), "Q", { clientId: "chung" });
    expect(a.messageId).not.toBe(b.messageId);
  });
});

describe("xoá hội thoại / tắt server khi đang stream", () => {
  it("xoá hội thoại đang stream: hủy AI, web nhận CANCELLED, tin bị xoá hẳn, slot được nhả", async () => {
    const account = newAccount();
    const gate = controllable();
    answerer.script = gate.script;
    const accepted = await ask(account, "Q");
    const running = accepted.run();
    await gate.hasStarted;

    await deleteConversation(account, accepted.conversationId);
    await running;

    expect(events.terminal(accepted.messageId)).toHaveLength(1);
    expect(events.terminal(accepted.messageId)[0]).toMatchObject({
      type: "error",
      payload: { code: "CANCELLED" }
    });
    expect(await HandbookConversationModel.findById(accepted.conversationId)).toBeNull();
    expect(
      await HandbookMessageModel.countDocuments({ conversation: accepted.conversationId })
    ).toBe(0);
    expect(runningAnswers.size).toBe(0);
    expect(redisMock.__store.has(lockKey(account))).toBe(false);
    // kết quả hoàn tất đúng lúc bị xoá cũng không "sống lại"
    expect(await HandbookMessageModel.countDocuments({})).toBe(0);
  });

  it("tắt server: hủy mọi câu đang chạy, chốt AI_UNAVAILABLE + hoàn lượt + báo web rồi mới kết thúc", async () => {
    const a = newAccount();
    const b = newAccount();
    const gate = controllable();
    answerer.script = gate.script;
    const first = await ask(a, "Q");
    const second = await ask(b, "Q");
    const runs = [first.run(), second.run()];
    await gate.hasStarted;

    await shutdownHandbookAssistant(3000);
    await Promise.all(runs);

    [first, second].forEach((accepted) => {
      expect(events.terminal(accepted.messageId)).toHaveLength(1);
      expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    });
    expect((await usageOf(a))?.used).toBe(0);
    expect((await usageOf(b))?.used).toBe(0);
    expect(await HandbookMessageModel.countDocuments({ status: "streaming" })).toBe(0);
    expect(runningAnswers.size).toBe(0);
  });

  it("tắt server khi không có gì chạy thì trả về ngay", async () => {
    const startedAt = Date.now();
    await shutdownHandbookAssistant(3000);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
