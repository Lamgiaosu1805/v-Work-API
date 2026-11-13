import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AgentMessageModel from "../src/models/AgentMessageModel";
import AgentUsageModel from "../src/models/AgentUsageModel";
import AgentConversationModel from "../src/models/AgentConversationModel";
import type { AgentDefinition } from "../src/modules/agent-harness";
import { AnthropicToolLoop } from "../src/modules/agent-harness/infrastructure/ai/anthropic-tool-loop";
import { prepareAgentAsk } from "../src/modules/agent-harness/application/ask-agent.service";
import type { AgentHarnessDeps } from "../src/modules/agent-harness/application/agent-harness.deps";

// Lõi agent harness: vòng gọi công cụ (model giả theo đúng hình dạng Messages API), hạn mức, khoá trùng, chốt kết quả.

let mongod: MongoMemoryServer;
const id = () => new mongoose.Types.ObjectId();
const accountId = String(id());
const employeeId = String(id());

type Turn = { content: any[]; stop_reason: string };

/** Model giả: mỗi lần gọi trả lượt kế tiếp trong kịch bản, phát text delta như stream thật. */
function scriptedModel(turns: Turn[], seen: any[] = []) {
  let call = 0;
  return new AnthropicToolLoop(() => "test-key", ((params: any) => {
    seen.push(JSON.parse(JSON.stringify(params)));
    const turn = turns[Math.min(call, turns.length - 1)];
    call += 1;
    const listeners: Record<string, ((arg?: any) => void)[]> = {};
    return {
      on(event: string, listener: (arg?: any) => void) {
        (listeners[event] ??= []).push(listener);
        return this;
      },
      async finalMessage() {
        if ((turn as any).throws) throw (turn as any).throws;
        turn.content.forEach((block) => {
          (listeners.streamEvent ?? []).forEach((l) => l());
          if (block.type === "text") (listeners.text ?? []).forEach((l) => l(block.text));
        });
        return {
          id: "msg",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: turn.content,
          stop_reason: turn.stop_reason,
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 }
        };
      }
    };
  }) as any);
}

const toolRuns: any[] = [];
const agent: AgentDefinition = {
  code: "test-agent",
  name: "Agent thử",
  description: "",
  permission: { action: "agent.test.use", subject: "AgentTest" },
  systemPrompt: "Bạn là agent thử.",
  buildContext: async () => "[Ngữ cảnh] thử",
  tools: [
    {
      name: "get_number",
      description: "Lấy một con số",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
        additionalProperties: false
      },
      async run(input, ctx) {
        toolRuns.push({ input, employeeId: ctx.employeeId });
        if (input.key === "boom") throw new Error("Không có số liệu");
        return { value: 42 };
      }
    }
  ],
  model: { env: "TEST_AGENT_MODEL", default: "claude-sonnet-5-5" },
  effort: { env: "TEST_AGENT_EFFORT", default: "low" },
  maxTokens: 1000,
  maxToolRounds: 2,
  dailyQuota: 2,
  envPrefix: "TEST_AGENT",
  suggestions: []
};

function makeDeps(
  model: AnthropicToolLoop,
  lock: () => Promise<any> = async () => async () => undefined
) {
  const events: any[] = [];
  const sink = (type: string) => (_account: string, payload: any) =>
    events.push({ type, ...payload });
  const deps: AgentHarnessDeps = {
    model,
    events: {
      start: sink("start"),
      delta: sink("delta"),
      tool: sink("tool"),
      done: sink("done"),
      error: sink("error")
    },
    acquireBusyLock: lock
  };
  return { deps, events };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  toolRuns.length = 0;
  await Promise.all([
    AgentMessageModel.deleteMany({}),
    AgentUsageModel.deleteMany({}),
    AgentConversationModel.deleteMany({})
  ]);
});

const usageOf = async () => (await AgentUsageModel.findOne({ account: accountId }).lean()) as any;

describe("vòng gọi công cụ", () => {
  test("gọi công cụ rồi trả lời: chạy đúng công cụ với người hỏi, gửi lại kết quả, chốt tin nhắn + chi phí", async () => {
    const seen: any[] = [];
    const model = scriptedModel(
      [
        {
          content: [
            { type: "thinking", thinking: "", signature: "sig" },
            { type: "text", text: "Để tôi tra." },
            { type: "tool_use", id: "tu_1", name: "get_number", input: { key: "a" } }
          ],
          stop_reason: "tool_use"
        },
        { content: [{ type: "text", text: "Kết quả là **42**." }], stop_reason: "end_turn" }
      ],
      seen
    );
    const { deps, events } = makeDeps(model);
    const accepted = await prepareAgentAsk(deps, {
      agent,
      accountId,
      employeeId,
      question: "Số là bao nhiêu?"
    });
    await accepted.run();

    expect(toolRuns).toEqual([{ input: { key: "a" }, employeeId }]);
    // Lượt 2 gửi lại nguyên lượt assistant (cả khối thinking) + tool_result
    expect(seen[1].messages.at(-2).content[0]).toMatchObject({
      type: "thinking",
      signature: "sig"
    });
    expect(seen[1].messages.at(-1).content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: JSON.stringify({ value: 42 })
    });
    // System + công cụ có điểm cache, công cụ strict
    expect(seen[0].system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(seen[0].tools[0]).toMatchObject({ strict: true, cache_control: { type: "ephemeral" } });
    expect(seen[0].messages[0].content).toContain("[Ngữ cảnh] thử");

    expect(events.map((e) => e.type)).toEqual(["delta", "tool", "delta", "done"]);
    const message = (await AgentMessageModel.findById(accepted.messageId).lean()) as any;
    expect(message).toMatchObject({
      status: "done",
      content: "Để tôi tra.\n\nKết quả là **42**.",
      rounds: 2,
      stop_reason: "end_turn",
      usage: { input: 200, output: 40, cacheRead: 100 }
    });
    expect(message.tool_calls).toEqual([expect.objectContaining({ name: "get_number", ok: true })]);
    expect(message.cost_usd).toBeGreaterThan(0);
    expect(await usageOf()).toMatchObject({ used: 1, output_tokens: 40 });
  });

  test("công cụ lỗi → gửi tool_result is_error cho model tự xử lý", async () => {
    const seen: any[] = [];
    const model = scriptedModel(
      [
        {
          content: [{ type: "tool_use", id: "tu_1", name: "get_number", input: { key: "boom" } }],
          stop_reason: "tool_use"
        },
        { content: [{ type: "text", text: "Chưa có số liệu." }], stop_reason: "end_turn" }
      ],
      seen
    );
    const { deps } = makeDeps(model);
    const accepted = await prepareAgentAsk(deps, { agent, accountId, employeeId, question: "?" });
    await accepted.run();
    expect(seen[1].messages.at(-1).content[0]).toMatchObject({
      is_error: true,
      content: "Không có số liệu"
    });
    const message = (await AgentMessageModel.findById(accepted.messageId).lean()) as any;
    expect(message.tool_calls[0]).toMatchObject({ ok: false, error: "Không có số liệu" });
  });

  test("vượt số vòng công cụ: vòng cuối kèm lời nhắc, model vẫn đòi công cụ → dừng max_rounds", async () => {
    const seen: any[] = [];
    const loop = {
      content: [{ type: "tool_use", id: "tu", name: "get_number", input: { key: "a" } }],
      stop_reason: "tool_use"
    };
    const { deps } = makeDeps(scriptedModel([loop], seen));
    const accepted = await prepareAgentAsk(deps, { agent, accountId, employeeId, question: "?" });
    await accepted.run();
    expect(toolRuns).toHaveLength(2);
    // Vòng 1 không nhắc; sau vòng công cụ cuối (vòng 2) mới kèm lời nhắc trả lời bằng dữ liệu đã có
    expect(seen[1].messages.at(-1).content.at(-1)).toMatchObject({ type: "tool_result" });
    expect(seen[2].messages.at(-1).content.at(-1)).toMatchObject({ type: "text" });
    const message = (await AgentMessageModel.findById(accepted.messageId).lean()) as any;
    expect(message).toMatchObject({ status: "done", stop_reason: "max_rounds", rounds: 3 });
    expect(message.content).toContain("hỏi cụ thể hơn");
  });

  test("model từ chối → không chạy công cụ của lượt đó, trả lời từ chối lịch sự", async () => {
    const model = scriptedModel([
      {
        content: [{ type: "tool_use", id: "tu", name: "get_number", input: { key: "a" } }],
        stop_reason: "refusal"
      }
    ]);
    const { deps } = makeDeps(model);
    const accepted = await prepareAgentAsk(deps, { agent, accountId, employeeId, question: "?" });
    await accepted.run();
    expect(toolRuns).toHaveLength(0);
    const message = (await AgentMessageModel.findById(accepted.messageId).lean()) as any;
    expect(message.content).toContain("không thể trả lời");
  });

  test("lỗi API trước khi có chữ → hoàn lượt, tin nhắn lỗi, báo web", async () => {
    const model = scriptedModel([
      { content: [], stop_reason: "end_turn", throws: new Error("overloaded") } as any
    ]);
    const { deps, events } = makeDeps(model);
    const accepted = await prepareAgentAsk(deps, { agent, accountId, employeeId, question: "?" });
    await accepted.run();
    expect(events.at(-1)).toMatchObject({ type: "error", code: "AI_FAILED" });
    expect(((await AgentMessageModel.findById(accepted.messageId).lean()) as any).status).toBe(
      "error"
    );
    expect((await usageOf()).used).toBe(0);
  });
});

describe("hạn mức và khoá", () => {
  test("hết lượt trong ngày → QUOTA_EXCEEDED; hỏi trùng khi đang chạy → BUSY", async () => {
    const answer = { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };
    for (let i = 0; i < 2; i += 1) {
      const { deps } = makeDeps(scriptedModel([answer]));
      await (await prepareAgentAsk(deps, { agent, accountId, employeeId, question: "?" })).run();
    }
    const { deps } = makeDeps(scriptedModel([answer]));
    await expect(
      prepareAgentAsk(deps, { agent, accountId, employeeId, question: "?" })
    ).rejects.toMatchObject({
      errorCode: "QUOTA_EXCEEDED"
    });

    const busy = makeDeps(scriptedModel([answer]), async () => null);
    await expect(
      prepareAgentAsk(busy.deps, { agent, accountId: String(id()), employeeId, question: "?" })
    ).rejects.toMatchObject({ errorCode: "BUSY" });
  });

  test("tiếp tục hội thoại: gửi kèm lịch sử, không cho mở hội thoại của người khác", async () => {
    const seen: any[] = [];
    const answer = { content: [{ type: "text", text: "Trả lời 1" }], stop_reason: "end_turn" };
    const { deps } = makeDeps(
      scriptedModel([answer, { ...answer, content: [{ type: "text", text: "Trả lời 2" }] }], seen)
    );
    const first = await prepareAgentAsk(deps, { agent, accountId, employeeId, question: "Câu 1" });
    await first.run();
    const second = await prepareAgentAsk(deps, {
      agent,
      accountId,
      employeeId,
      conversationId: first.conversationId,
      question: "Câu 2"
    });
    await second.run();
    expect(seen[1].messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(seen[1].messages[1].content).toBe("Trả lời 1");

    await expect(
      prepareAgentAsk(deps, {
        agent,
        accountId: String(id()),
        employeeId,
        conversationId: first.conversationId,
        question: "?"
      })
    ).rejects.toMatchObject({ errorCode: "CONVERSATION_NOT_FOUND" });
  });
});
