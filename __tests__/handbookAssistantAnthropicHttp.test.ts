import http from "http";
import { AddressInfo } from "net";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import redisMock from "./mocks/redis";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import { AnthropicHandbookAnswerer } from "../src/modules/handbook-assistant/infrastructure/ai/anthropic-handbook-answerer";
import { prepareAsk } from "../src/modules/handbook-assistant/application/ask-question.service";
import { clearPromptArticleCache } from "../src/modules/handbook-assistant/application/prompt-articles.service";
import { runningAnswers } from "../src/modules/handbook-assistant/application/running-answers.registry";
import { cancelAnswer } from "../src/modules/handbook-assistant/application/cancel-answer.service";
import {
  AnswerFailure,
  PromptArticle
} from "../src/modules/handbook-assistant/application/ports/handbook-answerer.port";
import { importHandbookDraft, publishHandbookVersion } from "../src/modules/handbook-assistant";
import HandbookVersionModel from "../src/models/HandbookVersionModel";
import HandbookArticleModel from "../src/models/HandbookArticleModel";
import HandbookConversationModel from "../src/models/HandbookConversationModel";
import HandbookMessageModel from "../src/models/HandbookMessageModel";
import HandbookUsageModel from "../src/models/HandbookUsageModel";
import sampleManifest from "../scripts/handbook/sample-handbook.manifest.json";
import { RecordingEvents, createDeps, sleep, waitFor } from "./helpers/handbookAssistantFakes";
/* eslint-enable import/first */

// SDK Anthropic THẬT nói chuyện với một server SSE giả qua ANTHROPIC_BASE_URL: kiểm chứng việc phân
// tích stream thật (citations_delta, usage ở message_start/message_delta, ping, retry, ngắt kết nối)
// mà bản stub của SDK trong handbookAssistantAnthropicAdapter.test.ts không chứng minh được.

interface SeenRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
  closedEarly: boolean;
}

type Handler = (
  req: SeenRequest,
  res: http.ServerResponse,
  raw: http.IncomingMessage
) => void | Promise<void>;

let fake: http.Server;
let baseUrl: string;
let handler: Handler;
let seen: SeenRequest[] = [];

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const messageStart = (usage: Record<string, unknown> = {}) =>
  sse("message_start", {
    type: "message_start",
    message: {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 1200,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1010,
        cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 1000 },
        ...usage
      }
    }
  });

const textStart = (index: number) =>
  sse("content_block_start", {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" }
  });
const textDelta = (index: number, text: string) =>
  sse("content_block_delta", {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text }
  });
const citationDelta = (index: number, citation: Record<string, unknown>) =>
  sse("content_block_delta", {
    type: "content_block_delta",
    index,
    delta: { type: "citations_delta", citation }
  });
const blockStop = (index: number) =>
  sse("content_block_stop", { type: "content_block_stop", index });
const messageEnd = (stopReason = "end_turn", outputTokens = 42) =>
  sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens }
  }) + sse("message_stop", { type: "message_stop" });

const sseHeaders = { "content-type": "text/event-stream", "cache-control": "no-cache" };

const articles: PromptArticle[] = [
  {
    documentCode: "NOI_QUY",
    documentTitle: "Nội quy lao động",
    articleIdx: 7,
    label: "Nội quy – Điều 7",
    title: "Điều 7. Thời giờ làm việc",
    chapter: "",
    blocks: ["1. Giờ làm việc:", "2. Thứ Bảy làm sáng."]
  }
];

const callbacks = () => ({ onActivity: jest.fn(), onTextDelta: jest.fn() });
const request = (signal = new AbortController().signal) => ({
  articles,
  history: [],
  question: "Giờ làm việc?",
  signal
});

const ENV_KEYS = ["ANTHROPIC_BASE_URL", "HANDBOOK_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const record: SeenRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null,
        closedEarly: false
      };
      res.on("close", () => {
        if (!res.writableEnded) record.closedEarly = true;
      });
      seen.push(record);
      Promise.resolve(handler(record, res, req)).catch(() => res.destroy());
    });
  });
  await new Promise<void>((resolve) => {
    fake.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});

afterAll(async () => {
  fake.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    fake.close(() => resolve());
  });
});

beforeEach(() => {
  seen = [];
  ENV_KEYS.forEach((k) => {
    savedEnv[k] = process.env[k];
  });
  process.env.ANTHROPIC_BASE_URL = baseUrl;
  process.env.HANDBOOK_ANTHROPIC_API_KEY = "sk-test-fake";
  delete process.env.ANTHROPIC_API_KEY;
  handler = (_req, res) => {
    res.writeHead(500);
    res.end();
  };
});
afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
});

describe("AnthropicHandbookAnswerer ↔ API qua HTTP thật", () => {
  it("phân tích stream đầy đủ: ping, thinking rỗng, text nhiều khối, citations_delta, usage hợp nhất", async () => {
    handler = async (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart());
      res.write(sse("ping", { type: "ping" }));
      res.write(
        sse("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" }
        }) +
          sse("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "signature_delta", signature: "sig" }
          }) +
          blockStop(0)
      );
      res.write(textStart(1));
      res.write(textDelta(1, "Theo Điều 7, "));
      res.write(
        citationDelta(1, {
          type: "content_block_location",
          cited_text: "1. Giờ làm việc:2. Thứ Bảy làm sáng.",
          document_index: 0,
          document_title: "Điều 7",
          start_block_index: 0,
          end_block_index: 2
        })
      );
      res.write(blockStop(1));
      res.write(textStart(2));
      res.write(textDelta(2, "giờ làm là "));
      res.write(textDelta(2, "8 tiếng."));
      res.write(blockStop(2));
      res.write(messageEnd("end_turn", 42));
      res.end();
    };
    const cb = callbacks();

    const result = await new AnthropicHandbookAnswerer().answer(request(), cb);

    expect(cb.onTextDelta.mock.calls.map((c) => c[0])).toEqual([
      "Theo Điều 7, ",
      "giờ làm là ",
      "8 tiếng."
    ]);
    expect(cb.onActivity.mock.calls.length).toBeGreaterThanOrEqual(10); // mọi sự kiện, kể cả ping/thinking
    expect(result).toMatchObject({
      text: "Theo Điều 7, giờ làm là 8 tiếng.",
      stopReason: "end_turn",
      model: "claude-haiku-5-5"
    });
    expect(result.citations).toEqual([
      {
        documentIndex: 0,
        startBlock: 0,
        endBlock: 2,
        citedText: "1. Giờ làm việc:2. Thứ Bảy làm sáng."
      }
    ]);
    // input/cache từ message_start, output cuối cùng từ message_delta
    expect(result.usage).toEqual({
      input: 1200,
      output: 42,
      cacheRead: 0,
      cacheWrite5m: 10,
      cacheWrite1h: 1000
    });
  });

  it("request thật gửi lên đúng: endpoint, header, và thân không có tham số bị API từ chối", async () => {
    handler = (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart() + textStart(0) + textDelta(0, "ok") + blockStop(0) + messageEnd());
      res.end();
    };
    await new AnthropicHandbookAnswerer().answer(request(), callbacks());

    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect([call.method, call.url]).toEqual(["POST", "/v1/messages"]);
    expect(call.headers["x-api-key"]).toBe("sk-test-fake");
    expect(call.headers["anthropic-version"]).toBeTruthy();
    expect(call.body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 8000,
      stream: true,
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" }
    });
    for (const forbidden of ["thinking", "temperature", "top_p", "top_k", "fallbacks"]) {
      expect(call.body).not.toHaveProperty(forbidden);
    }
    const [{ content }] = call.body.messages;
    expect(content[0]).toMatchObject({
      type: "document",
      citations: { enabled: true },
      cache_control: { type: "ephemeral", ttl: "1h" },
      source: { type: "content" }
    });
    expect(content.at(-1)).toEqual({ type: "text", text: "Giờ làm việc?" });
  });

  it("stop_reason max_tokens được giữ nguyên", async () => {
    handler = (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(
        messageStart() +
          textStart(0) +
          textDelta(0, "cắt") +
          blockStop(0) +
          messageEnd("max_tokens", 8000)
      );
      res.end();
    };
    const result = await new AnthropicHandbookAnswerer().answer(request(), callbacks());
    expect(result.stopReason).toBe("max_tokens");
    expect(result.usage.output).toBe(8000);
  });

  it("hủy giữa chừng làm ĐỨT kết nối thật tới API và vẫn trả usage đã nhận", async () => {
    handler = async (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart() + textStart(0) + textDelta(0, "Đang trả lời"));
      // không bao giờ kết thúc — chờ client hủy
    };
    const controller = new AbortController();
    const cb = callbacks();
    const pending = new AnthropicHandbookAnswerer()
      .answer(request(controller.signal), cb)
      .catch((e) => e);

    await waitFor(() => cb.onTextDelta.mock.calls.length > 0, 3000, "chữ đầu tiên");
    controller.abort();
    const error = await pending;

    expect(error).toBeInstanceOf(AnswerFailure);
    expect(error.kind).toBe("aborted");
    expect(error.usage).toMatchObject({ input: 1200, cacheWrite1h: 1000 });
    await waitFor(() => seen[0].closedEarly, 3000, "server thấy kết nối bị đóng");
  });

  it("server đứt kết nối giữa chừng → AnswerFailure kèm usage, không treo", async () => {
    handler = async (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart() + textStart(0) + textDelta(0, "một phần"));
      await sleep(20);
      res.destroy();
    };
    const error = await new AnthropicHandbookAnswerer()
      .answer(request(), callbacks())
      .catch((e) => e);
    expect(error).toBeInstanceOf(AnswerFailure);
    expect(error.kind).not.toBe("aborted");
    expect(error.usage.input).toBe(1200);
  });

  it("sự kiện `error` trong stream (overloaded) → AnswerFailure", async () => {
    handler = (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart());
      res.write(
        sse("error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } })
      );
      res.end();
    };
    const error = await new AnthropicHandbookAnswerer()
      .answer(request(), callbacks())
      .catch((e) => e);
    expect(error).toBeInstanceOf(AnswerFailure);
    expect(error.message).toMatch(/overloaded/i);
  });

  describe("lỗi HTTP và retry (SDK retry đúng 1 lần)", () => {
    const errorBody = (type: string) =>
      JSON.stringify({ type: "error", error: { type, message: type } });
    const failThenSucceed = (status: number, type: string) => {
      let calls = 0;
      handler = (_req, res) => {
        calls += 1;
        if (calls === 1) {
          res.writeHead(status, { "content-type": "application/json", "retry-after-ms": "5" });
          res.end(errorBody(type));
          return;
        }
        res.writeHead(200, sseHeaders);
        res.write(messageStart() + textStart(0) + textDelta(0, "ok") + blockStop(0) + messageEnd());
        res.end();
      };
    };
    const alwaysFail = (status: number, type: string) => {
      handler = (_req, res) => {
        res.writeHead(status, { "content-type": "application/json", "retry-after-ms": "5" });
        res.end(errorBody(type));
      };
    };

    it("429 một lần rồi thành công → tự retry, người dùng không thấy lỗi", async () => {
      failThenSucceed(429, "rate_limit_error");
      const result = await new AnthropicHandbookAnswerer().answer(request(), callbacks());
      expect(result.text).toBe("ok");
      expect(seen).toHaveLength(2);
    });

    it("500 một lần rồi thành công → tự retry", async () => {
      failThenSucceed(500, "api_error");
      expect((await new AnthropicHandbookAnswerer().answer(request(), callbacks())).text).toBe(
        "ok"
      );
      expect(seen).toHaveLength(2);
    });

    it("429 liên tục → sau đúng 1 lần retry báo rate_limited", async () => {
      alwaysFail(429, "rate_limit_error");
      const error = await new AnthropicHandbookAnswerer()
        .answer(request(), callbacks())
        .catch((e) => e);
      expect(error).toBeInstanceOf(AnswerFailure);
      expect(error.kind).toBe("rate_limited");
      expect(seen).toHaveLength(2);
    });

    it("529 quá tải liên tục → overloaded", async () => {
      alwaysFail(529, "overloaded_error");
      const error = await new AnthropicHandbookAnswerer()
        .answer(request(), callbacks())
        .catch((e) => e);
      expect(error.kind).toBe("overloaded");
    });

    it("401 sai key → auth, KHÔNG retry", async () => {
      alwaysFail(401, "authentication_error");
      const error = await new AnthropicHandbookAnswerer()
        .answer(request(), callbacks())
        .catch((e) => e);
      expect(error.kind).toBe("auth");
      expect(seen).toHaveLength(1);
    });

    it("400 yêu cầu sai → bad_request, KHÔNG retry", async () => {
      alwaysFail(400, "invalid_request_error");
      const error = await new AnthropicHandbookAnswerer()
        .answer(request(), callbacks())
        .catch((e) => e);
      expect(error.kind).toBe("bad_request");
      expect(seen).toHaveLength(1);
    });
  });

  it("countPromptTokens gọi đúng endpoint count_tokens với đúng prompt", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: 777 }));
    };
    expect(await new AnthropicHandbookAnswerer().countPromptTokens(articles)).toBe(777);
    expect([seen[0].method, seen[0].url]).toEqual(["POST", "/v1/messages/count_tokens"]);
    expect(seen[0].body).toMatchObject({ model: "claude-haiku-5-5" });
    expect(seen[0].body.messages[0].content.at(-1)).toEqual({ type: "text", text: "Xin chào" });
  });
});

describe("toàn bộ luồng hỏi với adapter + SDK thật (chỉ API là giả)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models: mongoose.Model<any>[] = [
    HandbookVersionModel,
    HandbookArticleModel,
    HandbookConversationModel,
    HandbookMessageModel,
    HandbookUsageModel
  ];
  let replset: MongoMemoryReplSet;
  let events: RecordingEvents;
  const account = new mongoose.Types.ObjectId().toString();
  let seq = 0;

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
      .filter((key) => key.startsWith("HANDBOOK_") && key !== "HANDBOOK_ANTHROPIC_API_KEY")
      .forEach((key) => delete process.env[key]);
    events = new RecordingEvents();
    const draft = await importHandbookDraft({
      manifest: JSON.parse(JSON.stringify(sampleManifest))
    });
    await publishHandbookVersion({ versionNo: draft.versionNo });
  });

  const ask = (question: string) => {
    seq += 1;
    return prepareAsk(createDeps(new AnthropicHandbookAnswerer(), events), {
      accountId: account,
      conversationId: null,
      question,
      clientId: `http-${seq}`
    });
  };

  it("trả lời có trích dẫn: done kèm citation đúng điều, usage/chi phí được lưu từ chính stream", async () => {
    handler = async (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart({ input_tokens: 5000 }));
      res.write(
        textStart(0) +
          textDelta(0, "Bạn được nghỉ 12 ngày.") +
          citationDelta(0, {
            type: "content_block_location",
            cited_text: "x",
            document_index: 3, // Điều 12 trong bộ mẫu
            document_title: "Điều 12",
            start_block_index: 0,
            end_block_index: 1
          }) +
          blockStop(0)
      );
      res.write(messageEnd("end_turn", 60));
      res.end();
    };

    const accepted = await ask("Nghỉ phép năm được mấy ngày?");
    await accepted.run();

    const done = events.terminal(accepted.messageId)[0];
    expect(done.type).toBe("done");
    expect(done.payload.citations).toEqual([
      expect.objectContaining({
        documentCode: "NOI_QUY@1",
        label: "Nội quy – Điều 12",
        articleIdx: 12,
        citedText:
          "1. Người lao động làm việc đủ 12 tháng được nghỉ phép năm 12 ngày làm việc, hưởng nguyên lương."
      })
    ]);
    const stored = await HandbookMessageModel.findById(accepted.messageId).lean();
    expect(stored?.ai?.usage).toMatchObject({ input: 5000, output: 60, cacheWrite1h: 1000 });
    expect(stored?.ai?.costUsd).toBeGreaterThan(0);
    // prompt thật gửi lên chứa đủ 7 điều làm document
    const docs = seen[0].body.messages[0].content.filter((b: any) => b.type === "document");
    expect(docs).toHaveLength(7);
  });

  it("người dùng bấm Dừng khi API đang stream: kết nối tới API bị đóng, lưu CANCELLED", async () => {
    handler = async (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart() + textStart(0) + textDelta(0, "Đang trả lời"));
    };
    const accepted = await ask("Q");
    const running = accepted.run();
    await waitFor(() => events.of("delta")[0], 3000, "delta đầu tiên");

    await cancelAnswer(createDeps(new AnthropicHandbookAnswerer(), events), {
      accountId: account,
      messageId: accepted.messageId
    });
    await running;

    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("CANCELLED");
    await waitFor(() => seen[0].closedEarly, 3000, "API thấy kết nối đóng");
    expect(await HandbookMessageModel.findById(accepted.messageId)).toMatchObject({
      status: "cancelled",
      content: "Đang trả lời"
    });
  });

  it("API im lặng quá hạn idle: watchdog hủy, đóng kết nối, báo AI_UNAVAILABLE và hoàn lượt", async () => {
    process.env.HANDBOOK_STREAM_IDLE_MS = "200";
    handler = async (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart() + textStart(0) + textDelta(0, "Chữ đầu"));
      // rồi im lặng
    };
    const accepted = await ask("Q");
    await accepted.run();

    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    await waitFor(() => seen[0].closedEarly, 3000, "API thấy kết nối đóng");
    expect((await HandbookUsageModel.findOne({ account }))?.used).toBe(0);
  });

  it("API trả sentinel ngoài phạm vi: REFUSED, không stream chữ nào và đóng kết nối ngay", async () => {
    handler = async (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart() + textStart(0) + textDelta(0, "[NGOAI_") + textDelta(0, "PHAM_VI]"));
      // giữ stream mở — phải do phía mình ngắt
    };
    const accepted = await ask("Giá vàng?");
    await accepted.run();

    expect(events.of("delta")).toHaveLength(0);
    expect(events.terminal(accepted.messageId)[0].payload.code).toBe("REFUSED");
    await waitFor(() => seen[0].closedEarly, 3000, "API thấy kết nối đóng");
  });

  it("API lỗi 500 liên tục: AI_UNAVAILABLE, hoàn lượt, hỏi lại được sau khi API hồi phục", async () => {
    handler = (_req, res) => {
      res.writeHead(500, { "content-type": "application/json", "retry-after-ms": "5" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }));
    };
    const failed = await ask("Q1");
    await failed.run();
    expect(events.terminal(failed.messageId)[0].payload.code).toBe("AI_UNAVAILABLE");
    expect((await HandbookUsageModel.findOne({ account }))?.used).toBe(0);

    handler = (_req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(messageStart() + textStart(0) + textDelta(0, "ok") + blockStop(0) + messageEnd());
      res.end();
    };
    const retry = await ask("Q1");
    await retry.run();
    expect(events.terminal(retry.messageId)[0].type).toBe("done");
  });
});
