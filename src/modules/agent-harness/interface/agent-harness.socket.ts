import type { Server, Socket } from "socket.io";
import { canEmployee } from "../../../core/authorization/can-employee";
import { logger } from "../../../config/logger";
import { getAgent } from "../application/agent-registry";
import { getAgentApiKey } from "../application/agent-harness.config";
import type { AgentEventSink, AgentHarnessDeps } from "../application/agent-harness.deps";
import { prepareAgentAsk } from "../application/ask-agent.service";
import { runningRuns } from "../application/running-runs.registry";
import { AgentHarnessError, toAgentHarnessError } from "../domain/agent-harness.errors";
import { AnthropicToolLoop } from "../infrastructure/ai/anthropic-tool-loop";
import { acquireBusyLock } from "../infrastructure/busy-lock";

// Socket của agent harness: `agent:ask` / `agent:cancel` (client → server), `agent:start|delta|tool|done|error`
// (server → room account:<id>). Hỏi AI qua socket vì một câu có thể lâu hơn timeout 30s của REST.
export const AGENT_SOCKET_EVENTS = {
  ASK: "agent:ask",
  CANCEL: "agent:cancel",
  START: "agent:start",
  DELTA: "agent:delta",
  TOOL: "agent:tool",
  DONE: "agent:done",
  ERROR: "agent:error"
} as const;

type Ack = (payload: unknown) => void;

function onceAck(callback: unknown): Ack {
  let called = false;
  return (payload) => {
    if (called || typeof callback !== "function") return;
    called = true;
    callback(payload);
  };
}

function runDetached(work: Promise<unknown>, label: string): void {
  work.catch((error) => {
    logger.error(`Agent harness: lỗi không bắt được ở ${label}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

export function createSocketEventSink(io: Server): AgentEventSink {
  const room = (accountId: string) => io.to(`account:${accountId}`);
  return {
    start: (accountId, payload) => room(accountId).emit(AGENT_SOCKET_EVENTS.START, payload),
    delta: (accountId, payload) => room(accountId).emit(AGENT_SOCKET_EVENTS.DELTA, payload),
    tool: (accountId, payload) => room(accountId).emit(AGENT_SOCKET_EVENTS.TOOL, payload),
    done: (accountId, payload) => room(accountId).emit(AGENT_SOCKET_EVENTS.DONE, payload),
    error: (accountId, payload) => room(accountId).emit(AGENT_SOCKET_EVENTS.ERROR, payload)
  };
}

export function createDefaultAgentDeps(io: Server): AgentHarnessDeps {
  return {
    // Khoá API dùng chung cho mọi agent (xem getAgentApiKey)
    model: new AnthropicToolLoop(getAgentApiKey),
    events: createSocketEventSink(io),
    acquireBusyLock
  };
}

async function handleAsk(
  deps: AgentHarnessDeps,
  socket: Socket,
  payload: unknown,
  callback: unknown
) {
  const reply = onceAck(callback);
  const { accountId, userInfoId } = socket.data as { accountId?: string; userInfoId?: string };
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  let accepted: Awaited<ReturnType<typeof prepareAgentAsk>> | null = null;
  try {
    if (!accountId || !userInfoId) throw new AgentHarnessError("FORBIDDEN");
    const agent = getAgent(body.agentCode);
    if (!agent) throw new AgentHarnessError("UNKNOWN_AGENT");
    if (!(await canEmployee(userInfoId, agent.permission.action, agent.permission.subject))) {
      throw new AgentHarnessError("FORBIDDEN");
    }
    // Danh tính chỉ lấy từ socket đã xác thực — KHÔNG đọc từ payload
    accepted = await prepareAgentAsk(deps, {
      agent,
      accountId,
      employeeId: userInfoId,
      conversationId: body.conversationId,
      question: body.question,
      clientId: body.clientId
    });
    reply({ ok: true, conversationId: accepted.conversationId, messageId: accepted.messageId });
    deps.events.start(accountId, {
      agentCode: agent.code,
      clientId: accepted.clientId,
      conversationId: accepted.conversationId,
      messageId: accepted.messageId
    });
  } catch (error) {
    const agentError = toAgentHarnessError(error);
    if (!(error instanceof AgentHarnessError)) {
      logger.error("Agent harness: lỗi khi nhận câu hỏi", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    reply({ ok: false, code: agentError.errorCode, message: agentError.message });
  } finally {
    if (accepted) runDetached(accepted.run(), "run");
  }
}

export function setupAgentHarnessSocket(io: Server, deps?: AgentHarnessDeps): void {
  const resolved = deps ?? createDefaultAgentDeps(io);
  io.on("connection", (socket: Socket) => {
    socket.on(AGENT_SOCKET_EVENTS.ASK, (payload: unknown, callback: unknown) => {
      runDetached(handleAsk(resolved, socket, payload, callback), AGENT_SOCKET_EVENTS.ASK);
    });
    socket.on(AGENT_SOCKET_EVENTS.CANCEL, (payload: unknown, callback: unknown) => {
      const reply = onceAck(callback);
      const { accountId } = socket.data as { accountId?: string };
      const messageId =
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>).messageId
          : undefined;
      reply({
        ok:
          Boolean(accountId) &&
          runningRuns.cancel(accountId!, typeof messageId === "string" ? messageId : undefined)
      });
    });
  });
}

export function shutdownAgentHarness(): void {
  runningRuns.abortAll();
}
