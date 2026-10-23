/* eslint-disable max-classes-per-file */
import {
  AnswerCallbacks,
  AnswerFailure,
  AnswerRequest,
  AnswerResult,
  AnswerUsage,
  HandbookAnswerer,
  RawCitation
} from "../../src/modules/handbook-assistant/application/ports/handbook-answerer.port";
import type {
  HandbookAssistantDeps,
  HandbookEventSink
} from "../../src/modules/handbook-assistant/application/handbook-assistant.deps";
import { runningAnswers } from "../../src/modules/handbook-assistant/application/running-answers.registry";

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const USAGE: AnswerUsage = {
  input: 1200,
  output: 80,
  cacheRead: 0,
  cacheWrite5m: 10,
  cacheWrite1h: 1000
};

export function okResult(text: string, over: Partial<AnswerResult> = {}): AnswerResult {
  return {
    text,
    citations: [],
    stopReason: "end_turn",
    model: "claude-haiku-5-5",
    usage: { ...USAGE },
    ...over
  };
}

// Chờ `ms` mili giây hoặc tới khi bị hủy (khi đó giống SDK: reject AnswerFailure("aborted")).
export function sleepAbortable(ms: number, signal: AbortSignal, usage = USAGE): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new AnswerFailure("aborted", "đã hủy", { ...usage }));
    if (signal.aborted) {
      fail();
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    function onAbort() {
      clearTimeout(timer);
      fail();
    }
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type AnswerScript = (
  request: AnswerRequest,
  callbacks: AnswerCallbacks
) => Promise<AnswerResult>;

// Stream từng mảnh chữ rồi trả kết quả; hủy được ở bất kỳ lúc nào.
export function streamText(
  chunks: string[],
  options: { delayMs?: number; result?: Partial<AnswerResult>; citations?: RawCitation[] } = {}
): AnswerScript {
  return async (request, callbacks) => {
    for (const chunk of chunks) {
      await sleepAbortable(options.delayMs ?? 1, request.signal);
      callbacks.onActivity();
      callbacks.onTextDelta(chunk);
    }
    return okResult(chunks.join(""), { citations: options.citations ?? [], ...options.result });
  };
}

export class FakeAnswerer implements HandbookAnswerer {
  configured = true;

  calls: AnswerRequest[] = [];

  script: AnswerScript;

  constructor() {
    // streamText khai báo bên dưới (function declaration được hoist) nên dùng được ngay ở đây
    this.script = streamText(["Xin chào"]);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  answer(request: AnswerRequest, callbacks: AnswerCallbacks): Promise<AnswerResult> {
    this.calls.push(request);
    return this.script(request, callbacks);
  }
}

// Bị điều khiển từ test: phát một vài mảnh rồi chờ `release()` mới trả kết quả (hoặc bị hủy).
export function controllable(chunks: string[] = ["Đang trả lời"]) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started: () => void = () => undefined;
  const hasStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const script: AnswerScript = async (request, callbacks) => {
    for (const chunk of chunks) {
      callbacks.onActivity();
      callbacks.onTextDelta(chunk);
    }
    started();
    await Promise.race([
      gate,
      new Promise<void>((_, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(new AnswerFailure("aborted", "đã hủy", { ...USAGE })),
          { once: true }
        );
      })
    ]);
    return okResult(chunks.join(""));
  };
  return { script, release: () => release(), hasStarted };
}

export function failWith(
  kind: ConstructorParameters<typeof AnswerFailure>[0],
  afterChunks: string[] = []
): AnswerScript {
  return async (_request, callbacks) => {
    for (const chunk of afterChunks) {
      callbacks.onActivity();
      callbacks.onTextDelta(chunk);
    }
    throw new AnswerFailure(kind, `lỗi ${kind}`, { ...USAGE });
  };
}

export interface RecordedEvent {
  type: "start" | "delta" | "done" | "error";
  accountId: string;
  payload: any;
}

export class RecordingEvents implements HandbookEventSink {
  events: RecordedEvent[] = [];

  start(accountId: string, payload: any) {
    this.events.push({ type: "start", accountId, payload });
  }

  delta(accountId: string, payload: any) {
    this.events.push({ type: "delta", accountId, payload });
  }

  done(accountId: string, payload: any) {
    this.events.push({ type: "done", accountId, payload });
  }

  error(accountId: string, payload: any) {
    this.events.push({ type: "error", accountId, payload });
  }

  of(type: RecordedEvent["type"], messageId?: string) {
    return this.events.filter(
      (e) => e.type === type && (!messageId || e.payload.messageId === messageId)
    );
  }

  terminal(messageId: string) {
    return this.events.filter(
      (e) => (e.type === "done" || e.type === "error") && e.payload.messageId === messageId
    );
  }

  deltaText(messageId: string): string {
    return this.of("delta", messageId)
      .map((e) => e.payload.text)
      .join("");
  }
}

export async function waitFor<T>(
  predicate: () => T | Promise<T>,
  timeoutMs = 3000,
  label = "điều kiện"
): Promise<NonNullable<T>> {
  const startedAt = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value as NonNullable<T>;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Quá thời gian chờ ${label}`);
    await sleep(5);
  }
}

export function createDeps(
  answerer: HandbookAnswerer,
  events: HandbookEventSink,
  over: Partial<HandbookAssistantDeps> = {}
): HandbookAssistantDeps {
  return {
    answerer,
    events,
    registry: runningAnswers,
    acquireBusyLock: async () => async () => undefined,
    ...over
  };
}
