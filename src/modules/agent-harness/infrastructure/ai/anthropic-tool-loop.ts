import Anthropic from "@anthropic-ai/sdk";
import {
  AgentFailure,
  AgentFailureKind,
  AgentModelClient,
  AgentUsage,
  ToolCallLog,
  ToolLoopCallbacks,
  ToolLoopRequest,
  ToolLoopResult,
  emptyUsage
} from "../../application/ports/agent-model.port";

// Vòng lặp công cụ thủ công trên Messages API (stream + finalMessage mỗi vòng). Đã đối chiếu tài liệu Claude API:
// - Sonnet 5.5: thinking adaptive bật sẵn (không gửi `thinking`), độ sâu qua `output_config.effort`; khối thinking của
//   vòng trước được gửi lại NGUYÊN VẸN trong lượt assistant (message.content).
// - Không ép tool_choice (any/tool trả 400 trên Sonnet 5.5) — để auto, công cụ `strict: true` giữ đúng schema.
// - Không bật eager_input_streaming: tham số công cụ rất nhỏ, giữ để server kiểm tra schema strict.
// - Dừng ở `refusal` (không chạy công cụ của lượt đó), `max_tokens` khi đang gọi công cụ (tham số có thể bị cắt).
// - Prompt caching: system + danh sách công cụ cố định (điểm cache ở công cụ cuối), cache tự động cho đuôi hội thoại.
const CONNECT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;
const MAX_TOOL_RESULT_CHARS = 30_000;
const ROUND_LIMIT_NOTE =
  "Đã đạt giới hạn số lần tra cứu cho câu hỏi này. Hãy trả lời ngay bằng dữ liệu đã có, nói rõ phần nào chưa tra được.";

function addUsage(target: AgentUsage, usage: Anthropic.Usage | null | undefined): void {
  if (!usage) return;
  target.input += usage.input_tokens ?? 0;
  target.output += usage.output_tokens ?? 0;
  target.cacheRead += usage.cache_read_input_tokens ?? 0;
  if (usage.cache_creation) {
    target.cacheWrite5m += usage.cache_creation.ephemeral_5m_input_tokens ?? 0;
    target.cacheWrite1h += usage.cache_creation.ephemeral_1h_input_tokens ?? 0;
  } else {
    target.cacheWrite5m += usage.cache_creation_input_tokens ?? 0;
  }
}

function classify(error: unknown, signal: AbortSignal): AgentFailureKind {
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) return "aborted";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.APIConnectionError) return "connection";
  if (error instanceof Anthropic.APIError) {
    const { status } = error;
    if (status === 429) return "rate_limited";
    if (status === 401 || status === 403) return "auth";
    if (status === 400 || status === 404 || status === 422) return "bad_request";
    if (typeof status === "number" && status >= 500) return "overloaded";
  }
  return "unknown";
}

const stringify = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (đã cắt bớt — hãy hỏi hẹp hơn)`
    : text;
};

export interface StreamFactory {
  (
    params: Anthropic.MessageStreamParams,
    options: { signal: AbortSignal }
  ): {
    on(event: "text", listener: (delta: string) => void): unknown;
    on(event: "streamEvent", listener: () => void): unknown;
    finalMessage(): Promise<Anthropic.Message>;
  };
}

export class AnthropicToolLoop implements AgentModelClient {
  private client: Anthropic | null = null;

  private clientKey = "";

  constructor(
    private readonly apiKey: () => string,
    private readonly streamFactory?: StreamFactory
  ) {}

  isConfigured(): boolean {
    return Boolean(this.streamFactory) || Boolean(this.apiKey());
  }

  private stream(params: Anthropic.MessageStreamParams, signal: AbortSignal) {
    if (this.streamFactory) return this.streamFactory(params, { signal });
    const key = this.apiKey();
    if (!this.client || this.clientKey !== key) {
      this.client = new Anthropic({
        apiKey: key,
        maxRetries: MAX_RETRIES,
        timeout: CONNECT_TIMEOUT_MS
      });
      this.clientKey = key;
    }
    return this.client.messages.stream(params, { signal });
  }

  async run(request: ToolLoopRequest, callbacks: ToolLoopCallbacks): Promise<ToolLoopResult> {
    const usage = emptyUsage();
    const toolCalls: ToolCallLog[] = [];
    const texts: string[] = [];
    let { model } = request;
    let rounds = 0;

    const tools = request.tools.map((tool, index) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      strict: true,
      ...(index === request.tools.length - 1
        ? { cache_control: { type: "ephemeral" as const } }
        : {})
    })) as Anthropic.Tool[];
    const messages: Anthropic.MessageParam[] = [
      ...request.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: request.userMessage }
    ];

    try {
      for (;;) {
        rounds += 1;
        const stream = this.stream(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            output_config: { effort: request.effort },
            cache_control: { type: "ephemeral" },
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            tools,
            messages
          } as Anthropic.MessageStreamParams,
          request.signal
        );
        stream.on("streamEvent", () => callbacks.onActivity());
        stream.on("text", (delta) => {
          if (delta) callbacks.onTextDelta(delta);
        });

        const message = await stream.finalMessage();
        addUsage(usage, message.usage);
        if (message.model) model = message.model;
        message.content.forEach((block) => {
          if (block.type === "text" && block.text) texts.push(block.text);
        });

        // Từ chối vì an toàn: không chạy công cụ của lượt này
        if (message.stop_reason === "refusal") {
          return {
            text: texts.join("\n\n"),
            stopReason: "refusal",
            model,
            rounds,
            usage,
            toolCalls
          };
        }
        if (message.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: message.content });
          continue;
        }
        const toolUses = message.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );
        if (!toolUses.length) {
          return {
            text: texts.join("\n\n"),
            stopReason: message.stop_reason ?? null,
            model,
            rounds,
            usage,
            toolCalls
          };
        }
        // Tham số công cụ có thể bị cắt ở max_tokens → không chạy
        if (message.stop_reason === "max_tokens") {
          return {
            text: texts.join("\n\n"),
            stopReason: "max_tokens",
            model,
            rounds,
            usage,
            toolCalls
          };
        }
        if (rounds > request.maxRounds) {
          return {
            text: texts.join("\n\n"),
            stopReason: "max_rounds",
            model,
            rounds,
            usage,
            toolCalls
          };
        }

        messages.push({ role: "assistant", content: message.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          const spec = request.tools.find((tool) => tool.name === use.name);
          const started = Date.now();
          callbacks.onToolCall(use.name);
          if (!spec) {
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              is_error: true,
              content: `Không có công cụ ${use.name}`
            });
            toolCalls.push({
              name: use.name,
              input: use.input,
              ok: false,
              error: "unknown_tool",
              ms: 0
            });
            continue;
          }
          try {
            const output = await spec.run(
              (use.input ?? {}) as Record<string, unknown>,
              request.ctx
            );
            results.push({ type: "tool_result", tool_use_id: use.id, content: stringify(output) });
            toolCalls.push({
              name: use.name,
              input: use.input,
              ok: true,
              error: null,
              ms: Date.now() - started
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              is_error: true,
              content: reason
            });
            toolCalls.push({
              name: use.name,
              input: use.input,
              ok: false,
              error: reason,
              ms: Date.now() - started
            });
          }
          callbacks.onActivity();
        }
        // Vòng cuối được phép: kèm lời nhắc trả lời luôn bằng dữ liệu đã có
        const content: (Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam)[] = [...results];
        if (rounds >= request.maxRounds) content.push({ type: "text", text: ROUND_LIMIT_NOTE });
        messages.push({ role: "user", content });
      }
    } catch (error) {
      if (error instanceof AgentFailure) throw error;
      throw new AgentFailure(
        classify(error, request.signal),
        error instanceof Error ? error.message : String(error),
        usage,
        toolCalls
      );
    }
  }
}
