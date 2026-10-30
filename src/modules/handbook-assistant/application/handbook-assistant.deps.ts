import type { HandbookErrorCode } from "../domain/handbook-assistant.errors";
import type { CitationView } from "../infrastructure/ai/citation-mapper";
import type { ReleaseLock } from "../infrastructure/busy-lock";
import type { HandbookAnswerer } from "./ports/handbook-answerer.port";
import type { RunningAnswersRegistry } from "./running-answers.registry";

// Nơi phát sự kiện `handbook:*` tới MỌI tab của tài khoản (interface/handbook-assistant.socket.ts
// gắn vào socket.io). Tách riêng để use-case không biết gì về socket và test được bằng sink giả.
export interface HandbookEventSink {
  start(
    accountId: string,
    payload: { clientId: string; conversationId: string; messageId: string }
  ): void;
  delta(accountId: string, payload: { messageId: string; text: string }): void;
  done(
    accountId: string,
    payload: { messageId: string; text: string; citations: CitationView[]; truncated: boolean }
  ): void;
  error(accountId: string, payload: { messageId: string; code: HandbookErrorCode }): void;
}

export interface HandbookAssistantDeps {
  answerer: HandbookAnswerer;
  events: HandbookEventSink;
  registry: RunningAnswersRegistry;
  // null = tiến trình khác đang giữ khoá của tài khoản (→ BUSY).
  acquireBusyLock(accountId: string, ttlMs: number): Promise<ReleaseLock | null>;
  now?: () => Date;
}
