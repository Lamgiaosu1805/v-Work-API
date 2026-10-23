import Anthropic from "@anthropic-ai/sdk";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import { AnthropicHandbookAnswerer } from "../src/modules/handbook-assistant/infrastructure/ai/anthropic-handbook-answerer";
import { SYSTEM_PROMPT } from "../src/modules/handbook-assistant/infrastructure/ai/prompt-builder";
import {
  AnswerFailure,
  PromptArticle
} from "../src/modules/handbook-assistant/application/ports/handbook-answerer.port";
/* eslint-enable import/first */

type Handler = (...args: any[]) => void;

interface FakeMessageOptions {
  text?: string;
  stopReason?: string | null;
  usage?: Record<string, unknown>;
  content?: unknown[];
  model?: string;
}

const defaultUsage = {
  input_tokens: 1200,
  output_tokens: 80,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 700,
  cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 500 }
};

function fakeMessage(options: FakeMessageOptions = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: options.model ?? "claude-haiku-5-5",
    content: options.content ?? [
      { type: "text", text: options.text ?? "Trả lời", citations: null }
    ],
    stop_reason: options.stopReason === undefined ? "end_turn" : options.stopReason,
    stop_sequence: null,
    usage: { ...defaultUsage, ...(options.usage ?? {}) }
  };
}

// Stream giả mô phỏng MessageStream của SDK: sự kiện chỉ bắt đầu chảy SAU khi người gọi đã đăng ký
// listener (giống stream thật), và tôn trọng AbortSignal bằng APIUserAbortError.
class FakeStream {
  private handlers: Record<string, Handler[]> = {};

  private readonly done: Promise<any>;

  constructor(
    private readonly script: (emit: (event: string, ...args: any[]) => void) => Promise<any>,
    signal?: AbortSignal | null
  ) {
    this.done = new Promise((resolve, reject) => {
      const abort = () => reject(new Anthropic.APIUserAbortError());
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort);
      setImmediate(() => {
        this.script((event, ...args) =>
          (this.handlers[event] ?? []).forEach((h) => h(...args))
        ).then(resolve, reject);
      });
    });
    this.done.catch(() => undefined);
  }

  on(event: string, handler: Handler) {
    (this.handlers[event] ??= []).push(handler);
    return this;
  }

  finalMessage() {
    return this.done;
  }
}

const articles: PromptArticle[] = [
  {
    documentCode: "NOI_QUY",
    documentTitle: "Nội quy lao động",
    articleIdx: 7,
    label: "Nội quy – Điều 7",
    title: "Điều 7. Thời giờ làm việc",
    chapter: "",
    blocks: ["1. Giờ làm việc:", "2. Thứ Bảy làm sáng."]
  },
  {
    documentCode: "NOI_QUY",
    documentTitle: "Nội quy lao động",
    articleIdx: 8,
    label: "Nội quy – Điều 8",
    title: "Điều 8. Chấm công",
    chapter: "",
    blocks: ["1. Chấm công trên vWork."]
  }
];

const callbacks = () => ({ onActivity: jest.fn(), onTextDelta: jest.fn() });
const request = (over: Record<string, unknown> = {}) => ({
  articles,
  history: [],
  question: "Giờ làm việc?",
  signal: new AbortController().signal,
  ...over
});

let streamSpy: jest.SpyInstance;
let countSpy: jest.SpyInstance;
let capturedParams: any;
let capturedOptions: any;
let capturedClient: any;

function useStream(script: (emit: (e: string, ...a: any[]) => void) => Promise<any>) {
  streamSpy.mockImplementation(function stub(this: any, params: any, options: any) {
    capturedParams = params;
    capturedOptions = options;
    capturedClient = this._client;
    return new FakeStream(script, options?.signal);
  });
}

const ENV_KEYS = [
  "HANDBOOK_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
  "HANDBOOK_AI_MODEL",
  "HANDBOOK_AI_EFFORT",
  "HANDBOOK_AI_MAX_TOKENS",
  "HANDBOOK_CACHE_TTL"
];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  streamSpy = jest.spyOn(Anthropic.Messages.prototype, "stream" as any);
  countSpy = jest.spyOn(Anthropic.Messages.prototype, "countTokens" as any);
});
afterAll(() => {
  streamSpy.mockRestore();
  countSpy.mockRestore();
});
beforeEach(() => {
  ENV_KEYS.forEach((k) => {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  });
  process.env.HANDBOOK_ANTHROPIC_API_KEY = "sk-test-key";
  capturedParams = undefined;
  capturedOptions = undefined;
  capturedClient = undefined;
  useStream(async () => fakeMessage());
});
afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
});

describe("AnthropicHandbookAnswerer — tham số gửi lên API", () => {
  it("dùng đúng model/effort/max_tokens mặc định, cache cấp request, KHÔNG gửi thinking/sampling", async () => {
    const answerer = new AnthropicHandbookAnswerer();
    await answerer.answer(request(), callbacks());

    expect(capturedParams.model).toBe("claude-haiku-5-5");
    expect(capturedParams.max_tokens).toBe(8000);
    expect(capturedParams.output_config).toEqual({ effort: "medium" });
    expect(capturedParams.cache_control).toEqual({ type: "ephemeral" });
    expect(capturedParams.system).toBe(SYSTEM_PROMPT);
    // Haiku 5.5: thinking adaptive luôn bật, tham số sampling bị API từ chối
    for (const forbidden of [
      "thinking",
      "temperature",
      "top_p",
      "top_k",
      "fallbacks",
      "betas",
      "stream"
    ]) {
      expect(capturedParams).not.toHaveProperty(forbidden);
    }
    expect(capturedOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("prompt: toàn bộ văn bản dạng document có citations, điểm cache 1h ở document cuối, câu hỏi cuối", async () => {
    await new AnthropicHandbookAnswerer().answer(request(), callbacks());

    expect(capturedParams.messages).toHaveLength(1);
    const [{ content }] = capturedParams.messages;
    expect(content.map((b: any) => b.type)).toEqual(["document", "document", "text"]);
    expect(content[0].citations).toEqual({ enabled: true });
    expect(content[0].source.content.map((b: any) => b.text)).toEqual([
      "1. Giờ làm việc:",
      "2. Thứ Bảy làm sáng."
    ]);
    expect(content[0].cache_control).toBeUndefined();
    expect(content[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(content[2]).toEqual({ type: "text", text: "Giờ làm việc?" });
  });

  it("lịch sử được gửi xen kẽ; câu hỏi hiện tại ở cuối", async () => {
    await new AnthropicHandbookAnswerer().answer(
      request({ history: [{ question: "Q1", answer: "A1" }], question: "Q2" }),
      callbacks()
    );
    expect(capturedParams.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(capturedParams.messages[1].content).toBe("A1");
    expect(capturedParams.messages[2].content).toBe("Q2");
  });

  it("đọc cấu hình mỗi lần gọi (model, effort, max_tokens, TTL cache)", async () => {
    process.env.HANDBOOK_AI_MODEL = "claude-sonnet-5-5";
    process.env.HANDBOOK_AI_EFFORT = "low";
    process.env.HANDBOOK_AI_MAX_TOKENS = "4000";
    process.env.HANDBOOK_CACHE_TTL = "5m";
    await new AnthropicHandbookAnswerer().answer(request(), callbacks());

    expect(capturedParams).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" }
    });
    expect(capturedParams.messages[0].content[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("client SDK dùng API key đã cấu hình, retry 1 lần, timeout kết nối 60s; đổi key thì tạo client mới", async () => {
    const answerer = new AnthropicHandbookAnswerer();
    await answerer.answer(request(), callbacks());
    expect(capturedClient.apiKey).toBe("sk-test-key");
    expect(capturedClient.maxRetries).toBe(1);
    expect(capturedClient.timeout).toBe(60_000);
    const first = capturedClient;

    await answerer.answer(request(), callbacks());
    expect(capturedClient).toBe(first);

    process.env.HANDBOOK_ANTHROPIC_API_KEY = "sk-doi-key";
    await answerer.answer(request(), callbacks());
    expect(capturedClient.apiKey).toBe("sk-doi-key");
    expect(capturedClient).not.toBe(first);
  });

  it("isConfigured phản ánh việc có API key (key riêng hoặc ANTHROPIC_API_KEY)", () => {
    const answerer = new AnthropicHandbookAnswerer();
    expect(answerer.isConfigured()).toBe(true);
    delete process.env.HANDBOOK_ANTHROPIC_API_KEY;
    expect(answerer.isConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-chung";
    expect(answerer.isConfigured()).toBe(true);
  });
});

describe("AnthropicHandbookAnswerer — stream & kết quả", () => {
  it("chuyển từng mảnh chữ cho callback theo đúng thứ tự, báo hoạt động cho mọi sự kiện", async () => {
    useStream(async (emit) => {
      emit("streamEvent", { type: "message_start" }, fakeMessage());
      emit("streamEvent", { type: "ping" }, fakeMessage());
      emit("text", "Theo ", "Theo ");
      emit("text", "", "Theo ");
      emit("text", "Điều 7", "Theo Điều 7");
      emit("streamEvent", { type: "message_stop" }, fakeMessage());
      return fakeMessage({ text: "Theo Điều 7" });
    });
    const cb = callbacks();

    const result = await new AnthropicHandbookAnswerer().answer(request(), cb);

    expect(cb.onTextDelta.mock.calls.map((c) => c[0])).toEqual(["Theo ", "Điều 7"]);
    expect(cb.onActivity).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      text: "Theo Điều 7",
      stopReason: "end_turn",
      model: "claude-haiku-5-5"
    });
  });

  it("ghép các khối text, bỏ khối không phải text (thinking)", async () => {
    useStream(async () =>
      fakeMessage({
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "Một. " },
          { type: "text", text: "Hai." }
        ]
      })
    );
    const result = await new AnthropicHandbookAnswerer().answer(request(), callbacks());
    expect(result.text).toBe("Một. Hai.");
  });

  it("lấy citation content_block_location theo chỉ số khối; bỏ các loại citation khác", async () => {
    useStream(async () =>
      fakeMessage({
        content: [
          {
            type: "text",
            text: "A",
            citations: [
              {
                type: "content_block_location",
                cited_text: "1. Giờ làm việc:2. Thứ Bảy làm sáng.",
                document_index: 0,
                document_title: "Điều 7",
                start_block_index: 0,
                end_block_index: 2
              },
              {
                type: "char_location",
                cited_text: "x",
                document_index: 0,
                document_title: null,
                start_char_index: 0,
                end_char_index: 1
              }
            ]
          },
          { type: "text", text: "B", citations: null },
          {
            type: "text",
            text: "C",
            citations: [
              {
                type: "content_block_location",
                cited_text: "1. Chấm công trên vWork.",
                document_index: 1,
                document_title: "Điều 8",
                start_block_index: 0,
                end_block_index: 1
              }
            ]
          }
        ]
      })
    );
    const result = await new AnthropicHandbookAnswerer().answer(request(), callbacks());
    expect(result.citations).toEqual([
      {
        documentIndex: 0,
        startBlock: 0,
        endBlock: 2,
        citedText: "1. Giờ làm việc:2. Thứ Bảy làm sáng."
      },
      { documentIndex: 1, startBlock: 0, endBlock: 1, citedText: "1. Chấm công trên vWork." }
    ]);
  });

  it("usage: tách cache ghi 5m/1h; stop_reason max_tokens được giữ nguyên", async () => {
    useStream(async () => fakeMessage({ stopReason: "max_tokens" }));
    const result = await new AnthropicHandbookAnswerer().answer(request(), callbacks());
    expect(result.usage).toEqual({
      input: 1200,
      output: 80,
      cacheRead: 5000,
      cacheWrite5m: 200,
      cacheWrite1h: 500
    });
    expect(result.stopReason).toBe("max_tokens");
  });

  it("usage: không có phân tách cache_creation thì quy theo TTL cấu hình; giá trị null → 0", async () => {
    useStream(async () =>
      fakeMessage({
        usage: {
          cache_creation: null,
          cache_creation_input_tokens: 900,
          cache_read_input_tokens: null
        }
      })
    );
    const answerer = new AnthropicHandbookAnswerer();
    const hourly = await answerer.answer(request(), callbacks());
    expect(hourly.usage).toMatchObject({ cacheWrite1h: 900, cacheWrite5m: 0, cacheRead: 0 });

    process.env.HANDBOOK_CACHE_TTL = "5m";
    const fiveMin = await answerer.answer(request(), callbacks());
    expect(fiveMin.usage).toMatchObject({ cacheWrite5m: 900, cacheWrite1h: 0 });
  });

  it("stop_reason refusal được trả về để tầng trên quyết định", async () => {
    useStream(async () => fakeMessage({ stopReason: "refusal", text: "" }));
    const result = await new AnthropicHandbookAnswerer().answer(request(), callbacks());
    expect(result.stopReason).toBe("refusal");
  });
});

describe("AnthropicHandbookAnswerer — hủy & lỗi", () => {
  it("hủy giữa chừng → AnswerFailure(aborted) kèm usage đã ghi nhận (input vẫn bị tính tiền)", async () => {
    const controller = new AbortController();
    useStream(
      (emit) =>
        new Promise(() => {
          emit(
            "streamEvent",
            { type: "message_start" },
            fakeMessage({ usage: { output_tokens: 1 } })
          );
          emit("text", "Đang trả lời", "Đang trả lời");
          setTimeout(() => controller.abort(), 20);
          // không bao giờ tự resolve — chỉ kết thúc bằng abort
        })
    );
    const cb = callbacks();

    const error = await new AnthropicHandbookAnswerer()
      .answer(request({ signal: controller.signal }), cb)
      .catch((e) => e);

    expect(error).toBeInstanceOf(AnswerFailure);
    expect(error.kind).toBe("aborted");
    expect(error.usage).toMatchObject({ input: 1200, output: 1, cacheRead: 5000 });
    expect(cb.onTextDelta).toHaveBeenCalledWith("Đang trả lời");
  });

  it("signal đã hủy từ trước → aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await new AnthropicHandbookAnswerer()
      .answer(request({ signal: controller.signal }), callbacks())
      .catch((e) => e);
    expect(error).toBeInstanceOf(AnswerFailure);
    expect(error.kind).toBe("aborted");
  });

  const apiError = (status: number) =>
    Anthropic.APIError.generate(
      status,
      { type: "error", error: { type: "api_error", message: `lỗi ${status}` } },
      `lỗi ${status}`,
      new Headers()
    );

  it.each([
    ["429 giới hạn tốc độ", () => apiError(429), "rate_limited"],
    ["500 lỗi máy chủ", () => apiError(500), "overloaded"],
    ["529 quá tải", () => apiError(529), "overloaded"],
    ["401 sai key", () => apiError(401), "auth"],
    ["403 bị từ chối", () => apiError(403), "auth"],
    ["400 yêu cầu sai", () => apiError(400), "bad_request"],
    ["404 không có model", () => apiError(404), "bad_request"],
    ["hết thời gian kết nối", () => new Anthropic.APIConnectionTimeoutError(), "timeout"],
    [
      "mất kết nối",
      () => new Anthropic.APIConnectionError({ message: "ECONNRESET" }),
      "connection"
    ],
    ["lỗi lạ", () => new Error("bất ngờ"), "unknown"]
  ])("ánh xạ lỗi: %s → %s", async (_name, make, kind) => {
    const cause = make();
    useStream(async () => {
      throw cause;
    });
    const error = await new AnthropicHandbookAnswerer()
      .answer(request(), callbacks())
      .catch((e) => e);

    expect(error).toBeInstanceOf(AnswerFailure);
    expect(error.kind).toBe(kind);
    expect(error.cause).toBe(cause);
    expect(error.message).toBeTruthy();
  });

  it("lỗi giữa chừng vẫn mang usage đã nhận được", async () => {
    useStream(async (emit) => {
      emit("streamEvent", { type: "message_start" }, fakeMessage());
      throw new Anthropic.APIConnectionError({ message: "đứt giữa chừng" });
    });
    const error = await new AnthropicHandbookAnswerer()
      .answer(request(), callbacks())
      .catch((e) => e);
    expect(error.kind).toBe("connection");
    expect(error.usage.input).toBe(1200);
  });

  it("không có Điều nào để dựng prompt → AnswerFailure, không gọi API", async () => {
    const error = await new AnthropicHandbookAnswerer()
      .answer(request({ articles: [] }), callbacks())
      .catch((e) => e);
    expect(error).toBeInstanceOf(AnswerFailure);
    expect(error.kind).toBe("unknown");
    expect(streamSpy).not.toHaveBeenCalled();
  });
});

describe("AnthropicHandbookAnswerer.countPromptTokens", () => {
  it("đếm token của đúng prompt sẽ gửi (toàn bộ văn bản + system + câu hỏi mẫu)", async () => {
    countSpy.mockResolvedValue({ input_tokens: 4321 });
    const tokens = await new AnthropicHandbookAnswerer().countPromptTokens(articles);

    expect(tokens).toBe(4321);
    const params = countSpy.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.system).toBe(SYSTEM_PROMPT);
    const [{ content }] = params.messages;
    expect(content.map((b: any) => b.type)).toEqual(["document", "document", "text"]);
    expect(content[2].text).toBe("Xin chào");
  });
});
