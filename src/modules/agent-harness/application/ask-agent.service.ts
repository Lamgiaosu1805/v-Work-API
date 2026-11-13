import mongoose from "mongoose";
import AgentConversationModel from "../../../models/AgentConversationModel";
import AgentMessageModel from "../../../models/AgentMessageModel";
import { logger } from "../../../config/logger";
import { AgentHarnessError } from "../domain/agent-harness.errors";
import type { AgentDefinition, AgentRunContext } from "../domain/agent-definition";
import { estimateCostUsd } from "../infrastructure/ai/model-pricing";
import {
  BUSY_LOCK_TTL_MS,
  HISTORY_MESSAGES,
  IDLE_TIMEOUT_MS,
  MAX_QUESTION_LENGTH,
  getAgentRuntimeConfig
} from "./agent-harness.config";
import type { AgentHarnessDeps } from "./agent-harness.deps";
import { AgentFailure, emptyUsage } from "./ports/agent-model.port";
import { recordAgentUsage, refundAgentQuota, reserveAgentQuota } from "./quota.service";
import { runningRuns } from "./running-runs.registry";

// Luồng hỏi 1 câu: kiểm tra → giữ khoá + lượt → ghi tin nhắn → (run) gọi model có công cụ, stream về web, chốt kết quả.
// Quyền dùng agent đã được kiểm tra ở tầng interface (canEmployee) trước khi gọi vào đây.

const REFUSAL_TEXT =
  "Xin lỗi, tôi không thể trả lời câu hỏi này. Bạn có thể hỏi về số liệu kinh doanh: doanh số, tăng net, so sánh TTKD, tình hình nộp báo cáo…";
const MAX_ROUNDS_TEXT =
  "Câu hỏi cần tra cứu quá nhiều lần trong một lượt. Bạn hỏi cụ thể hơn (một chỉ tiêu, một kỳ, vài đơn vị) giúp tôi nhé.";

export interface AskInput {
  agent: AgentDefinition;
  accountId: string;
  employeeId: string;
  conversationId?: unknown;
  question: unknown;
  clientId?: unknown;
  now?: Date;
}

export interface AcceptedAsk {
  conversationId: string;
  messageId: string;
  clientId: string | null;
  run(): Promise<void>;
}

const titleOf = (question: string) =>
  question.length > 80 ? `${question.slice(0, 77)}…` : question;

interface RunInput {
  agent: AgentDefinition;
  config: ReturnType<typeof getAgentRuntimeConfig>;
  ctx: AgentRunContext;
  conversationId: string;
  messageId: string;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  dateKey: string;
  release: () => Promise<void>;
}

async function runAnswer(deps: AgentHarnessDeps, input: RunInput): Promise<void> {
  const { agent, config, ctx, messageId, conversationId } = input;
  const controller = new AbortController();
  runningRuns.add(ctx.accountId, { messageId, controller });
  const started = Date.now();
  let streamed = "";
  let idleTimer: NodeJS.Timeout | null = null;
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  touch();

  try {
    const context = agent.buildContext ? await agent.buildContext(ctx) : "";
    const result = await deps.model.run(
      {
        model: config.model,
        effort: config.effort,
        maxTokens: agent.maxTokens,
        maxRounds: agent.maxToolRounds,
        system: agent.systemPrompt,
        history: input.history,
        userMessage: context ? `${context}\n\nCâu hỏi: ${input.question}` : input.question,
        tools: agent.tools,
        ctx,
        signal: controller.signal
      },
      {
        onTextDelta: (delta) => {
          touch();
          streamed += delta;
          deps.events.delta(ctx.accountId, { messageId, delta });
        },
        onToolCall: (name) => {
          touch();
          deps.events.tool(ctx.accountId, { messageId, name });
        },
        onActivity: touch
      }
    );

    let content = result.text.trim();
    if (result.stopReason === "refusal")
      content = content ? `${content}\n\n${REFUSAL_TEXT}` : REFUSAL_TEXT;
    if (result.stopReason === "max_rounds" && !content) content = MAX_ROUNDS_TEXT;
    if (!content) content = MAX_ROUNDS_TEXT;
    const costUsd = estimateCostUsd(result.model, result.usage);
    await AgentMessageModel.updateOne(
      { _id: messageId },
      {
        $set: {
          content,
          status: "done",
          model: result.model,
          stop_reason: result.stopReason,
          rounds: result.rounds,
          usage: result.usage,
          cost_usd: costUsd,
          tool_calls: result.toolCalls,
          latency_ms: Date.now() - started
        }
      }
    );
    await AgentConversationModel.updateOne(
      { _id: conversationId },
      { $set: { last_message_at: new Date() } }
    );
    await recordAgentUsage(ctx.accountId, agent.code, input.dateKey, result.usage, costUsd);
    deps.events.done(ctx.accountId, { messageId, conversationId, content, status: "done" });
  } catch (error) {
    const failure = error instanceof AgentFailure ? error : null;
    const cancelled = failure?.kind === "aborted";
    const usage = failure?.usage ?? emptyUsage();
    if (!cancelled) {
      logger.error(`Agent ${agent.code}: lỗi khi trả lời`, {
        messageId,
        kind: failure?.kind,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    // Chưa có chữ nào tới người dùng → hoàn lượt
    if (!streamed)
      await refundAgentQuota(ctx.accountId, agent.code, input.dateKey).catch(() => undefined);
    const costUsd = estimateCostUsd(input.config.model, usage);
    await AgentMessageModel.updateOne(
      { _id: messageId },
      {
        $set: {
          content: streamed,
          status: cancelled ? "cancelled" : "error",
          error_code: cancelled ? "CANCELLED" : (failure?.kind ?? "unknown"),
          usage,
          cost_usd: costUsd,
          tool_calls: failure?.toolCalls ?? [],
          latency_ms: Date.now() - started
        }
      }
    ).catch(() => undefined);
    if (streamed)
      await recordAgentUsage(ctx.accountId, agent.code, input.dateKey, usage, costUsd).catch(
        () => undefined
      );
    const code = cancelled ? "CANCELLED" : "AI_FAILED";
    deps.events.error(ctx.accountId, {
      messageId,
      code,
      message: new AgentHarnessError(code).message
    });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    runningRuns.remove(ctx.accountId, messageId);
    await input.release();
  }
}

export async function prepareAgentAsk(
  deps: AgentHarnessDeps,
  input: AskInput
): Promise<AcceptedAsk> {
  const { agent, accountId, employeeId } = input;
  const now = input.now ?? new Date();
  const config = getAgentRuntimeConfig(agent);
  if (!deps.model.isConfigured()) throw new AgentHarnessError("NOT_CONFIGURED");
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) throw new AgentHarnessError("INVALID_QUESTION");
  if (question.length > MAX_QUESTION_LENGTH) throw new AgentHarnessError("QUESTION_TOO_LONG");
  const clientId = typeof input.clientId === "string" ? input.clientId.slice(0, 64) : null;

  let conversation: any = null;
  if (input.conversationId) {
    if (!mongoose.isValidObjectId(input.conversationId))
      throw new AgentHarnessError("CONVERSATION_NOT_FOUND");
    conversation = await AgentConversationModel.findOne({
      _id: input.conversationId,
      account: accountId,
      agent_code: agent.code,
      isDeleted: false
    }).lean();
    if (!conversation) throw new AgentHarnessError("CONVERSATION_NOT_FOUND");
  }

  if (runningRuns.has(accountId)) throw new AgentHarnessError("BUSY");
  const release = await deps.acquireBusyLock(accountId, BUSY_LOCK_TTL_MS);
  if (!release) throw new AgentHarnessError("BUSY");

  let dateKey: string | null = null;
  try {
    dateKey = await reserveAgentQuota(accountId, agent.code, config.dailyQuota, now);
    if (!conversation) {
      conversation = await AgentConversationModel.create({
        agent_code: agent.code,
        account: accountId,
        employee: employeeId,
        title: titleOf(question),
        last_message_at: now
      });
    }
    const conversationId = String(conversation._id);
    const history = (
      (await AgentMessageModel.find({ conversation: conversationId, status: "done" })
        .sort({ seq: -1 })
        .limit(HISTORY_MESSAGES)
        .select("role content")
        .lean()) as any[]
    )
      .reverse()
      .filter((m) => m.content);
    // Lịch sử phải bắt đầu bằng lượt người dùng
    while (history.length && history[0].role !== "user") history.shift();

    const count = conversation.message_count ?? 0;
    await AgentMessageModel.create({
      conversation: conversationId,
      agent_code: agent.code,
      account: accountId,
      seq: count + 1,
      role: "user",
      content: question
    });
    const assistant = await AgentMessageModel.create({
      conversation: conversationId,
      agent_code: agent.code,
      account: accountId,
      seq: count + 2,
      role: "assistant",
      status: "streaming"
    });
    await AgentConversationModel.updateOne(
      { _id: conversationId },
      { $set: { last_message_at: now, message_count: count + 2 } }
    );
    const messageId = String(assistant._id);
    const reservedDate = dateKey;

    return {
      conversationId,
      messageId,
      clientId,
      run: () =>
        runAnswer(deps, {
          agent,
          config,
          ctx: { accountId, employeeId, now },
          conversationId,
          messageId,
          question,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          dateKey: reservedDate,
          release
        })
    };
  } catch (error) {
    if (dateKey) await refundAgentQuota(accountId, agent.code, dateKey).catch(() => undefined);
    await release();
    throw error;
  }
}

/** Khởi động lại giữa chừng → câu trả lời còn "streaming" quá 10 phút được chốt là lỗi. */
export async function recoverStaleAgentRuns(now: Date = new Date()): Promise<number> {
  const res = await AgentMessageModel.updateMany(
    { status: "streaming", updatedAt: { $lt: new Date(now.getTime() - 10 * 60_000) } },
    { $set: { status: "error", error_code: "INTERRUPTED" } }
  );
  return res.modifiedCount ?? 0;
}
