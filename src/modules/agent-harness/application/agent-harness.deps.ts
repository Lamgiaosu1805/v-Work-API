import type { AgentModelClient } from "./ports/agent-model.port";
import type { ReleaseLock } from "../infrastructure/busy-lock";

// Sự kiện gửi về web (socket room account:<id>) — mọi tab của người dùng cùng nhận.
export interface AgentEventSink {
  start(
    accountId: string,
    payload: {
      agentCode: string;
      clientId: string | null;
      conversationId: string;
      messageId: string;
    }
  ): void;
  delta(accountId: string, payload: { messageId: string; delta: string }): void;
  tool(accountId: string, payload: { messageId: string; name: string }): void;
  done(
    accountId: string,
    payload: { messageId: string; conversationId: string; content: string; status: string }
  ): void;
  error(accountId: string, payload: { messageId: string; code: string; message: string }): void;
}

export interface AgentHarnessDeps {
  model: AgentModelClient;
  events: AgentEventSink;
  acquireBusyLock(accountId: string, ttlMs: number): Promise<ReleaseLock | null>;
}
