import type { AgentEffort, AgentRunContext, AgentToolSpec } from "../../domain/agent-definition";

// Cổng gọi model có vòng lặp công cụ — adapter Anthropic ở infrastructure/ai; test thay bằng model giả.

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export const emptyUsage = (): AgentUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0
});

export interface ToolCallLog {
  name: string;
  input: unknown;
  ok: boolean;
  error: string | null;
  ms: number;
}

export interface ToolLoopRequest {
  model: string;
  effort: AgentEffort;
  maxTokens: number;
  maxRounds: number;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  tools: AgentToolSpec[];
  ctx: AgentRunContext;
  signal: AbortSignal;
}

export interface ToolLoopCallbacks {
  onTextDelta(delta: string): void;
  onToolCall(name: string): void;
  onActivity(): void;
}

export type ToolLoopStop = "end_turn" | "refusal" | "max_tokens" | "max_rounds" | string;

export interface ToolLoopResult {
  text: string;
  stopReason: ToolLoopStop | null;
  model: string;
  rounds: number;
  usage: AgentUsage;
  toolCalls: ToolCallLog[];
}

export type AgentFailureKind =
  | "aborted"
  | "timeout"
  | "connection"
  | "rate_limited"
  | "auth"
  | "bad_request"
  | "overloaded"
  | "unknown";

export class AgentFailure extends Error {
  constructor(
    readonly kind: AgentFailureKind,
    message: string,
    readonly usage: AgentUsage,
    readonly toolCalls: ToolCallLog[] = []
  ) {
    super(message);
  }
}

export interface AgentModelClient {
  isConfigured(): boolean;
  run(request: ToolLoopRequest, callbacks: ToolLoopCallbacks): Promise<ToolLoopResult>;
}
