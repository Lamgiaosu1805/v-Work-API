jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import {
  RefusalSentinelFilter,
  REFUSAL_SENTINEL,
  stripRefusalSentinel
} from "../src/modules/handbook-assistant/domain/refusal-sentinel";
import { selectHistoryTurns } from "../src/modules/handbook-assistant/domain/history-selection";
import {
  buildPrompt,
  SYSTEM_PROMPT
} from "../src/modules/handbook-assistant/infrastructure/ai/prompt-builder";
import { mapCitations } from "../src/modules/handbook-assistant/infrastructure/ai/citation-mapper";
import { estimateCostUsd } from "../src/modules/handbook-assistant/infrastructure/ai/model-pricing";
import { getHandbookAssistantConfig } from "../src/modules/handbook-assistant/application/handbook-assistant.config";
import { RunningAnswersRegistry } from "../src/modules/handbook-assistant/application/running-answers.registry";
import type { PromptArticle } from "../src/modules/handbook-assistant/application/ports/handbook-answerer.port";
/* eslint-enable import/first */

const article = (over: Partial<PromptArticle> = {}): PromptArticle => ({
  documentCode: "NOI_QUY",
  documentTitle: "Nội quy lao động",
  articleIdx: 7,
  label: "Nội quy – Điều 7",
  title: "Điều 7. Thời giờ làm việc",
  chapter: "Chương II. Thời giờ",
  blocks: ["1. Giờ làm việc:", "a) Sáng 08h00–12h00;", "b) Chiều 13h30–17h30."],
  ...over
});

describe("RefusalSentinelFilter", () => {
  const feed = (chunks: string[]) => {
    const filter = new RefusalSentinelFilter();
    let emitted = "";
    let refused = false;
    chunks.forEach((chunk) => {
      const out = filter.push(chunk);
      emitted += out.emit;
      refused = refused || out.refused;
    });
    emitted += filter.end().emit;
    return { emitted, refused };
  };

  it("nhận ra sentinel dù bị chia thành nhiều mảnh nhỏ và không phát ra chữ nào", () => {
    const out = feed(["[NGO", "AI_PH", "AM_VI", "]"]);
    expect(out).toEqual({ emitted: "", refused: true });
  });

  it("nhận ra sentinel khi có khoảng trắng/xuống dòng/markup ở đầu", () => {
    for (const prefix of ["\n", "  ", "**", "`", "> ", "\n\n**"]) {
      expect(feed([`${prefix}${REFUSAL_SENTINEL}`]).refused).toBe(true);
    }
  });

  it("câu trả lời thường được phát đầy đủ và đúng thứ tự, kể cả khi mở đầu giống sentinel", () => {
    expect(feed(["Theo ", "Điều 7", ", giờ làm là 8h."])).toEqual({
      emitted: "Theo Điều 7, giờ làm là 8h.",
      refused: false
    });
    // mở đầu bằng "[N" trùng tiền tố nhưng lệch ở ký tự kế tiếp → xả hết phần đã giữ
    expect(feed(["[N", "ội quy] cho biết..."])).toEqual({
      emitted: "[Nội quy] cho biết...",
      refused: false
    });
    expect(feed(["[1] Điều 7"])).toEqual({ emitted: "[1] Điều 7", refused: false });
  });

  it("giữ lại khoảng trắng đầu rồi xả ra khi chữ thật tới (không làm mất ký tự)", () => {
    expect(feed(["  ", "\n", "Xin chào"]).emitted).toBe("  \nXin chào");
  });

  it("hết stream khi vẫn đang giữ chữ (đoạn ngắn trùng tiền tố) thì xả ra", () => {
    expect(feed(["[NGOAI"])).toEqual({ emitted: "[NGOAI", refused: false });
    expect(feed(["   "])).toEqual({ emitted: "   ", refused: false });
  });

  it("đã quyết định thì không đệm nữa: sentinel xuất hiện về sau không bị coi là từ chối", () => {
    const out = feed(["Trả lời bình thường. ", REFUSAL_SENTINEL]);
    expect(out.refused).toBe(false);
    expect(out.emitted).toContain(REFUSAL_SENTINEL);
  });
});

describe("stripRefusalSentinel", () => {
  it("không có sentinel: chỉ trim", () => {
    expect(stripRefusalSentinel("  Xin chào  ")).toEqual({ text: "Xin chào", found: false });
  });

  it("chỉ có sentinel (kể cả bọc markup) → text rỗng", () => {
    expect(stripRefusalSentinel(REFUSAL_SENTINEL)).toEqual({ text: "", found: true });
    expect(stripRefusalSentinel(`**${REFUSAL_SENTINEL}**\n`)).toEqual({ text: "", found: true });
  });

  it("sentinel lẫn trong câu trả lời: bỏ ở mọi vị trí, giữ phần còn lại", () => {
    expect(stripRefusalSentinel(`Phần một. ${REFUSAL_SENTINEL} Phần hai.`)).toEqual({
      text: "Phần một.  Phần hai.",
      found: true
    });
  });
});

describe("selectHistoryTurns", () => {
  const msg = (seq: number, role: "user" | "assistant", content: string, status = "done") => ({
    seq,
    role,
    content,
    status
  });

  it("lấy các lượt đã hoàn tất theo thứ tự, bỏ lượt lỗi/hủy/đang chạy và tin hiện tại", () => {
    const turns = selectHistoryTurns(
      [
        msg(1, "user", "Q1"),
        msg(2, "assistant", "A1"),
        msg(3, "user", "Q2 lỗi"),
        msg(4, "assistant", "", "error"),
        msg(5, "user", "Q3 hủy"),
        msg(6, "assistant", "một phần", "cancelled"),
        msg(7, "user", "Q4"),
        msg(8, "assistant", "A4"),
        msg(9, "user", "Q5 hiện tại"),
        msg(10, "assistant", "", "streaming")
      ],
      9
    );
    expect(turns).toEqual([
      { question: "Q1", answer: "A1" },
      { question: "Q4", answer: "A4" }
    ]);
  });

  it("bỏ lượt thiếu tin trả lời hoặc nội dung rỗng; không phụ thuộc thứ tự đầu vào", () => {
    expect(
      selectHistoryTurns(
        [
          msg(4, "assistant", "A2"),
          msg(3, "user", "Q2"),
          msg(1, "user", "Q1 mồ côi"),
          msg(5, "user", "   "),
          msg(6, "assistant", "A")
        ],
        99
      )
    ).toEqual([{ question: "Q2", answer: "A2" }]);
  });

  it("hội thoại mới → không có lịch sử", () => {
    expect(selectHistoryTurns([], 1)).toEqual([]);
    expect(selectHistoryTurns([msg(1, "user", "Q hiện tại")], 1)).toEqual([]);
  });
});

describe("buildPrompt", () => {
  const articles = [
    article(),
    article({
      articleIdx: 8,
      label: "Nội quy – Điều 8",
      title: "Điều 8. Chấm công",
      blocks: ["1. Chấm công trên vWork."]
    })
  ];

  it("lượt đầu: 1 tin user = các document + câu hỏi, system cố định", () => {
    const prompt = buildPrompt({ articles, history: [], question: "Giờ làm?", cacheTtl: "1h" });

    expect(prompt.system).toBe(SYSTEM_PROMPT);
    expect(prompt.messages).toHaveLength(1);
    const content = prompt.messages[0].content as any[];
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({
      type: "document",
      source: {
        type: "content",
        content: [
          { type: "text", text: "1. Giờ làm việc:" },
          { type: "text", text: "a) Sáng 08h00–12h00;" },
          { type: "text", text: "b) Chiều 13h30–17h30." }
        ]
      },
      title: "Điều 7. Thời giờ làm việc",
      context: "Nội quy lao động | Nội quy – Điều 7 | Chương II. Thời giờ",
      citations: { enabled: true }
    });
    expect(content[1]).toMatchObject({ type: "document", title: "Điều 8. Chấm công" });
    expect(content[2]).toEqual({ type: "text", text: "Giờ làm?" });
  });

  it("điểm cache 1 giờ chỉ đặt ở document CUỐI; câu hỏi nằm sau điểm cache", () => {
    const content = buildPrompt({ articles, history: [], question: "Q", cacheTtl: "1h" })
      .messages[0].content as any[];
    expect(content[0].cache_control).toBeUndefined();
    expect(content[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(content[2].cache_control).toBeUndefined();
  });

  it("TTL 5 phút: không gửi trường ttl", () => {
    const content = buildPrompt({ articles, history: [], question: "Q", cacheTtl: "5m" })
      .messages[0].content as any[];
    expect(content[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("có lịch sử: câu hỏi đầu nằm trong tin user đầu, xen kẽ user/assistant, câu hiện tại cuối cùng", () => {
    const prompt = buildPrompt({
      articles,
      history: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" }
      ],
      question: "Q3",
      cacheTtl: "1h"
    });
    const roles = prompt.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect((prompt.messages[0].content as any[]).at(-1)).toEqual({ type: "text", text: "Q1" });
    expect(prompt.messages.slice(1).map((m) => m.content)).toEqual(["A1", "Q2", "A2", "Q3"]);
  });

  it("tất định: cùng đầu vào → cùng từng byte; phần đầu prompt không đổi giữa các lượt (cache)", () => {
    const base = { articles, cacheTtl: "1h" as const };
    const first = buildPrompt({ ...base, history: [], question: "Q1" });
    const again = buildPrompt({ ...base, history: [], question: "Q1" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));

    // Lượt 2: tin user đầu tiên giống hệt lượt 1 (cùng câu hỏi đầu) → cache của lượt 1 dùng lại được
    const second = buildPrompt({
      ...base,
      history: [{ question: "Q1", answer: "A1" }],
      question: "Q2"
    });
    expect(JSON.stringify(second.messages[0])).toBe(JSON.stringify(first.messages[0]));
  });

  it("không có Điều nào → lỗi; title dài bị cắt 200 ký tự", () => {
    expect(() =>
      buildPrompt({ articles: [], history: [], question: "Q", cacheTtl: "1h" })
    ).toThrow();
    const long = buildPrompt({
      articles: [article({ title: "x".repeat(500) })],
      history: [],
      question: "Q",
      cacheTtl: "1h"
    }).messages[0].content as any[];
    expect(long[0].title).toHaveLength(200);
  });

  it("system prompt nêu rõ sentinel và không chứa thông tin thay đổi theo thời gian", () => {
    expect(SYSTEM_PROMPT).toContain(REFUSAL_SENTINEL);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/);
  });
});

describe("mapCitations", () => {
  const articles = [
    article(),
    article({
      articleIdx: 8,
      label: "Nội quy – Điều 8",
      title: "Điều 8",
      blocks: ["1. A", "2. B", "3. C"]
    })
  ];

  it("khoản đơn: citedText là nguyên khoản; documentCode kèm phiên bản", () => {
    expect(
      mapCitations(
        [{ documentIndex: 0, startBlock: 1, endBlock: 2, citedText: "bỏ qua" }],
        articles,
        3
      )
    ).toEqual([
      {
        documentCode: "NOI_QUY@3",
        documentTitle: "Nội quy lao động",
        label: "Nội quy – Điều 7",
        articleIdx: 7,
        citedText: "a) Sáng 08h00–12h00;"
      }
    ]);
  });

  it("nhiều khoản: nối bằng xuống dòng — là chuỗi con NGUYÊN VĂN của content (web tô sáng bằng indexOf)", () => {
    const [citation] = mapCitations(
      [{ documentIndex: 1, startBlock: 0, endBlock: 3, citedText: "1. A2. B3. C" }],
      articles,
      1
    );
    expect(citation.citedText).toBe("1. A\n2. B\n3. C");
    const content = articles[1].blocks.join("\n");
    expect(content.indexOf(citation.citedText)).toBeGreaterThanOrEqual(0);
  });

  it("gộp trùng (cùng điều + cùng đoạn), giữ thứ tự xuất hiện", () => {
    const raw = [
      { documentIndex: 1, startBlock: 1, endBlock: 2, citedText: "x" },
      { documentIndex: 0, startBlock: 0, endBlock: 1, citedText: "x" },
      { documentIndex: 1, startBlock: 1, endBlock: 2, citedText: "x" }
    ];
    const mapped = mapCitations(raw, articles, 1);
    expect(mapped.map((c) => [c.articleIdx, c.citedText])).toEqual([
      [8, "2. B"],
      [7, "1. Giờ làm việc:"]
    ]);
  });

  it("bỏ citation sai chỉ số hoặc trỏ ra ngoài danh sách điều", () => {
    const raw = [
      { documentIndex: 5, startBlock: 0, endBlock: 1, citedText: "" },
      { documentIndex: 0, startBlock: 2, endBlock: 9, citedText: "" },
      { documentIndex: 0, startBlock: 2, endBlock: 2, citedText: "" },
      { documentIndex: 0, startBlock: -1, endBlock: 1, citedText: "" },
      { documentIndex: 0, startBlock: 0.5, endBlock: 1, citedText: "" },
      { documentIndex: 0, startBlock: 2, endBlock: 3, citedText: "" }
    ];
    expect(mapCitations(raw, articles, 1).map((c) => c.citedText)).toEqual([
      "b) Chiều 13h30–17h30."
    ]);
  });
});

describe("estimateCostUsd", () => {
  const usage = {
    input: 1000,
    output: 500,
    cacheRead: 100_000,
    cacheWrite5m: 200,
    cacheWrite1h: 3000
  };

  it("Haiku 5.5 bậc giá thấp (prompt ≤ 100K token)", () => {
    const small = {
      input: 1000,
      output: 500,
      cacheRead: 10_000,
      cacheWrite5m: 200,
      cacheWrite1h: 3000
    };
    // input 1000*0.1 + cacheRead 10000*0.1*0.1 + w5m 200*0.1*1.25 + w1h 3000*0.1*2 + output 500*0.5, /1e6
    expect(estimateCostUsd("claude-haiku-5-5", small)).toBeCloseTo(
      (100 + 100 + 25 + 600 + 250) / 1_000_000,
      9
    );
  });

  it("Haiku 5.5 bậc giá cao khi prompt vượt 100K token", () => {
    // prompt = 1000+100000+200+3000 = 104200 > 100K → input 0.5, output 2.5
    expect(estimateCostUsd("claude-haiku-5-5", usage)).toBeCloseTo(
      (1000 * 0.5 + 100_000 * 0.5 * 0.1 + 200 * 0.5 * 1.25 + 3000 * 0.5 * 2 + 500 * 2.5) /
        1_000_000,
      9
    );
  });

  it("Opus 5.5 / Sonnet 5.5 theo bảng giá; model lạ → null (không đoán)", () => {
    const u = {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0
    };
    expect(estimateCostUsd("claude-opus-5-5", u)).toBe(24);
    expect(estimateCostUsd("claude-sonnet-5-5", u)).toBe(12);
    expect(estimateCostUsd("model-khong-ton-tai", u)).toBeNull();
  });

  it("không dùng token → 0", () => {
    expect(
      estimateCostUsd("claude-haiku-5-5", {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite5m: 0,
        cacheWrite1h: 0
      })
    ).toBe(0);
  });
});

describe("getHandbookAssistantConfig", () => {
  const KEYS = Object.keys(process.env).filter(
    (k) => k.startsWith("HANDBOOK_") || k === "ANTHROPIC_API_KEY"
  );
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    delete process.env.HANDBOOK_ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    Object.keys(process.env)
      .filter((k) => k.startsWith("HANDBOOK_"))
      .forEach((k) => delete process.env[k]);
    KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it("mặc định theo lộ trình đã duyệt", () => {
    expect(getHandbookAssistantConfig()).toEqual({
      anthropicApiKey: "",
      model: "claude-haiku-5-5",
      effort: "medium",
      maxTokens: 8000,
      cacheTtl: "1h",
      dailyQuota: 30,
      maxTurns: 20,
      maxConcurrent: 10,
      retentionDays: 180,
      streamIdleMs: 60_000,
      firstTextMs: 75_000,
      maxDurationMs: 180_000,
      ackDeadlineMs: 10_000
    });
  });

  it("đọc env; API key riêng ưu tiên hơn ANTHROPIC_API_KEY", () => {
    process.env.ANTHROPIC_API_KEY = " chung ";
    expect(getHandbookAssistantConfig().anthropicApiKey).toBe("chung");
    process.env.HANDBOOK_ANTHROPIC_API_KEY = "rieng";
    expect(getHandbookAssistantConfig().anthropicApiKey).toBe("rieng");

    process.env.HANDBOOK_AI_MODEL = "claude-opus-5-5";
    process.env.HANDBOOK_AI_EFFORT = "high";
    process.env.HANDBOOK_CACHE_TTL = "5m";
    process.env.HANDBOOK_DAILY_QUOTA = "50";
    process.env.HANDBOOK_MAX_TURNS = "5";
    const config = getHandbookAssistantConfig();
    expect(config).toMatchObject({
      model: "claude-opus-5-5",
      effort: "high",
      cacheTtl: "5m",
      dailyQuota: 50,
      maxTurns: 5
    });
  });

  it("giá trị sai/không hợp lệ rơi về mặc định (không bao giờ ném lỗi)", () => {
    process.env.HANDBOOK_AI_EFFORT = "cực cao";
    process.env.HANDBOOK_CACHE_TTL = "2h";
    process.env.HANDBOOK_DAILY_QUOTA = "-3";
    process.env.HANDBOOK_MAX_TURNS = "1.5";
    process.env.HANDBOOK_AI_MAX_TOKENS = "abc";
    process.env.HANDBOOK_AI_MODEL = "   ";
    expect(getHandbookAssistantConfig()).toMatchObject({
      effort: "medium",
      cacheTtl: "1h",
      dailyQuota: 30,
      maxTurns: 20,
      maxTokens: 8000,
      model: "claude-haiku-5-5"
    });
  });
});

describe("RunningAnswersRegistry", () => {
  const claim = (
    registry: RunningAnswersRegistry,
    messageId: string,
    accountId: string,
    max = 10
  ) => registry.tryClaim({ messageId, accountId, maxConcurrent: max });

  it("mỗi tài khoản 1 câu: yêu cầu thứ hai bị từ chối cho tới khi nhả", () => {
    const registry = new RunningAnswersRegistry();
    expect(claim(registry, "m1", "a")).not.toBeNull();
    expect(claim(registry, "m2", "a")).toBeNull();
    expect(claim(registry, "m3", "b")).not.toBeNull();
    registry.release("m1");
    expect(claim(registry, "m4", "a")).not.toBeNull();
  });

  it("trần đồng thời toàn server", () => {
    const registry = new RunningAnswersRegistry();
    expect(claim(registry, "m1", "a", 2)).not.toBeNull();
    expect(claim(registry, "m2", "b", 2)).not.toBeNull();
    expect(claim(registry, "m3", "c", 2)).toBeNull();
    expect(registry.size).toBe(2);
  });

  it("abort ghi lý do đầu tiên rồi hủy; lý do sau không ghi đè", () => {
    const registry = new RunningAnswersRegistry();
    const entry = claim(registry, "m1", "a")!;
    expect(registry.abort("m1", "cancelled")).toBe(true);
    expect(registry.abort("m1", "idle")).toBe(true);
    expect(entry.abortReason).toBe("cancelled");
    expect(entry.controller.signal.aborted).toBe(true);
    expect(registry.abort("khong-co", "cancelled")).toBe(false);
  });

  it("abortByConversation / abortAll chỉ hủy đúng đối tượng", () => {
    const registry = new RunningAnswersRegistry();
    const a = claim(registry, "m1", "a")!;
    const b = claim(registry, "m2", "b")!;
    registry.setConversation("m1", "c1");
    registry.setConversation("m2", "c2");

    expect(registry.abortByConversation("c1", "deleted")).toBe(1);
    expect(a.controller.signal.aborted).toBe(true);
    expect(b.controller.signal.aborted).toBe(false);
    expect(registry.abortAll("shutdown")).toBe(2);
    expect(b.abortReason).toBe("shutdown");
  });

  it("release resolve `finished`; waitAllFinished chờ đủ hoặc hết hạn", async () => {
    const registry = new RunningAnswersRegistry();
    const entry = claim(registry, "m1", "a")!;
    let finished = false;
    entry.finished.then(() => {
      finished = true;
    });
    setTimeout(() => registry.release("m1"), 30);
    await registry.waitAllFinished(1000);
    expect(finished).toBe(true);
    expect(registry.size).toBe(0);

    claim(registry, "m2", "b");
    const started = Date.now();
    await registry.waitAllFinished(60);
    expect(Date.now() - started).toBeLessThan(500);
    expect(registry.size).toBe(1);
  });
});
