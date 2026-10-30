import Anthropic from "@anthropic-ai/sdk";
import {
  AnswerCallbacks,
  AnswerFailure,
  AnswerFailureKind,
  AnswerRequest,
  AnswerResult,
  AnswerUsage,
  HandbookAnswerer,
  PromptArticle,
  RawCitation,
  emptyUsage
} from "../../application/ports/handbook-answerer.port";
import {
  HandbookAssistantConfig,
  getHandbookAssistantConfig
} from "../../application/handbook-assistant.config";
import { buildPrompt } from "./prompt-builder";

// Timeout kết nối ban đầu của SDK; thời gian chờ chữ đầu tiên/treo giữa chừng do watchdog của
// answer-runner xử lý.
const CONNECT_TIMEOUT_MS = 60_000;
// SDK tự retry lỗi tạm thời (429/5xx/mạng). Giữ ở 1 để tổng thời gian chờ không vượt quá 90s của web.
const MAX_RETRIES = 1;
const SAMPLE_QUESTION = "Xin chào";

function absorbUsage(target: AnswerUsage, usage: Anthropic.Usage | null | undefined, ttl: string) {
  if (!usage) return;
  target.input = usage.input_tokens ?? target.input;
  target.output = usage.output_tokens ?? target.output;
  target.cacheRead = usage.cache_read_input_tokens ?? target.cacheRead;
  if (usage.cache_creation) {
    target.cacheWrite5m = usage.cache_creation.ephemeral_5m_input_tokens ?? 0;
    target.cacheWrite1h = usage.cache_creation.ephemeral_1h_input_tokens ?? 0;
  } else if (usage.cache_creation_input_tokens != null) {
    if (ttl === "1h") target.cacheWrite1h = usage.cache_creation_input_tokens;
    else target.cacheWrite5m = usage.cache_creation_input_tokens;
  }
}

function classify(error: unknown, signal: AbortSignal): AnswerFailureKind {
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

function collectCitations(content: Anthropic.ContentBlock[]): RawCitation[] {
  const citations: RawCitation[] = [];
  content.forEach((block) => {
    if (block.type !== "text" || !block.citations) return;
    block.citations.forEach((citation) => {
      if (citation.type !== "content_block_location") return;
      citations.push({
        documentIndex: citation.document_index,
        startBlock: citation.start_block_index,
        endBlock: citation.end_block_index,
        citedText: citation.cited_text
      });
    });
  });
  return citations;
}

// Adapter Anthropic cho cổng HandbookAnswerer. Dùng SDK TRỰC TIẾP (không qua src/config/anthropic.js
// — nhánh Gemini ở đó không có stream/citations/cache_control).
//
// Đặc thù model Haiku 5.5 đã đối chiếu tài liệu: thinking adaptive luôn bật (không gửi `thinking`,
// điều chỉnh bằng `output_config.effort`, thinking tính vào max_tokens); không gửi
// temperature/top_p/top_k, không prefill; không có fallback phía server.
export class AnthropicHandbookAnswerer implements HandbookAnswerer {
  private client: Anthropic | null = null;

  private clientKey = "";

  // eslint-disable-next-line class-methods-use-this
  isConfigured(): boolean {
    return Boolean(getHandbookAssistantConfig().anthropicApiKey);
  }

  private getClient(config: HandbookAssistantConfig): Anthropic {
    if (!this.client || this.clientKey !== config.anthropicApiKey) {
      this.client = new Anthropic({
        apiKey: config.anthropicApiKey,
        maxRetries: MAX_RETRIES,
        timeout: CONNECT_TIMEOUT_MS
      });
      this.clientKey = config.anthropicApiKey;
    }
    return this.client;
  }

  async answer(request: AnswerRequest, callbacks: AnswerCallbacks): Promise<AnswerResult> {
    const config = getHandbookAssistantConfig();
    const usage = emptyUsage();
    let { model } = config;

    try {
      const prompt = buildPrompt({
        articles: request.articles,
        history: request.history,
        question: request.question,
        cacheTtl: config.cacheTtl,
        personal: request.personal
      });

      const stream = this.getClient(config).messages.stream(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          output_config: { effort: config.effort },
          // Cache tự động (5 phút) cho phần đuôi hội thoại; phần văn bản có điểm cache riêng (xem prompt-builder).
          cache_control: { type: "ephemeral" },
          system: prompt.system,
          messages: prompt.messages
        },
        { signal: request.signal }
      );

      stream.on("streamEvent", (_event, snapshot) => {
        callbacks.onActivity();
        absorbUsage(usage, snapshot?.usage, config.cacheTtl);
        if (snapshot?.model) model = snapshot.model;
      });
      stream.on("text", (delta) => {
        if (delta) callbacks.onTextDelta(delta);
      });

      const final = await stream.finalMessage();
      absorbUsage(usage, final.usage, config.cacheTtl);
      return {
        text: final.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
        citations: collectCitations(final.content),
        stopReason: final.stop_reason ?? null,
        model: final.model ?? model,
        usage
      };
    } catch (error) {
      if (error instanceof AnswerFailure) throw error;
      throw new AnswerFailure(
        classify(error, request.signal),
        error instanceof Error ? error.message : String(error),
        usage,
        error
      );
    }
  }

  // Đếm token của đúng prompt sẽ gửi (toàn bộ văn bản + system + một câu hỏi mẫu ngắn). count_tokens
  // không sinh nội dung nên không tốn phí sinh chữ.
  async countPromptTokens(articles: PromptArticle[]): Promise<number> {
    const config = getHandbookAssistantConfig();
    const prompt = buildPrompt({
      articles,
      history: [],
      question: SAMPLE_QUESTION,
      cacheTtl: config.cacheTtl
    });
    const result = await this.getClient(config).messages.countTokens({
      model: config.model,
      system: prompt.system,
      messages: prompt.messages
    });
    return result.input_tokens;
  }
}
