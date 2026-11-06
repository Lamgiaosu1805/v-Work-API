import { logger } from "../../../config/logger";
import { selectHistoryTurns } from "../domain/history-selection";
import { findTicketCodes } from "../domain/ticket-code-extractor";
import type { HistoryTurn } from "../domain/history-selection";
import { RefusalSentinelFilter, stripRefusalSentinel } from "../domain/refusal-sentinel";
import { CitationView, mapCitations } from "../infrastructure/ai/citation-mapper";
import { estimateCostUsd } from "../infrastructure/ai/model-pricing";
import type { ReleaseLock } from "../infrastructure/busy-lock";
import {
  FinishUpdate,
  handbookChatRepository as chatRepo
} from "../infrastructure/handbook-chat.repository";
import type { HandbookAssistantDeps } from "./handbook-assistant.deps";
import { HandbookAssistantConfig, getHandbookAssistantConfig } from "./handbook-assistant.config";
import type { OwnTicketsContext } from "./ports/own-ticket-lookup.port";
import type { PersonalContext, TicketAccess } from "./ports/personal-context.port";
import type { ReferenceContext } from "./ports/reference-context.port";
import { getPromptArticles } from "./prompt-articles.service";
import {
  AnswerFailure,
  AnswerResult,
  AnswerUsage,
  PromptArticle,
  emptyUsage
} from "./ports/handbook-answerer.port";
import { recordAnswerUsage, refundQuota } from "./quota.service";
import type { AbortReason, RunningAnswer } from "./running-answers.registry";

export interface RunContext {
  entry: RunningAnswer;
  messageId: string;
  conversationId: string;
  accountId: string;
  // _id UserInfo của chính người hỏi (từ socket đã xác thực) — khoá để tra thông tin cá nhân của họ.
  userInfoId?: string;
  question: string;
  versionId: string;
  versionNo: number;
  // seq của tin user hiện tại (lịch sử = các tin có seq nhỏ hơn).
  userSeq: number;
  // Ngày (giờ VN) của lượt hạn mức đã giữ cho câu hỏi này.
  quotaDateKey: string;
  releaseLock: ReleaseLock;
}

// Tra dữ liệu (cá nhân / cấu hình) quá lâu thì bỏ qua (coi như không tra được) thay vì làm chậm câu trả lời.
const CONTEXT_LOOKUP_TIMEOUT_MS = 3000;

// Chạy một lần tra cứu có hạn giờ; quá hạn hoặc lỗi → `unavailable` (không bao giờ ném lỗi).
async function lookupWithTimeout<T>(
  lookup: () => Promise<T>,
  unavailable: T,
  what: string,
  messageId: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      lookup(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          logger.warn(`Trợ lý Nội quy: tra ${what} quá hạn, bỏ qua`, { messageId });
          resolve(unavailable);
        }, CONTEXT_LOOKUP_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    logger.warn(`Trợ lý Nội quy: không tra được ${what}`, {
      messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    return unavailable;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TICKET_ACCESS_KEYS: Array<keyof TicketAccess> = [
  "canCreate",
  "canView",
  "canHandle",
  "canAssignDepartment",
  "canAssignMember",
  "canManage",
  "canViewRestricted",
  "canViewSensitive",
  "canConfig"
];

// Chỉ nhận đúng 9 cờ boolean; thiếu / sai kiểu → null (chưa tra được), không đoán có quyền. undefined (cổng không
// tra quyền ticket) giữ nguyên để prompt không nhắc tới.
function sanitizeTicketAccess(
  value: TicketAccess | null | undefined
): TicketAccess | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return null;
  if (TICKET_ACCESS_KEYS.some((key) => typeof value[key] !== "boolean")) return null;
  return Object.fromEntries(
    TICKET_ACCESS_KEYS.map((key) => [key, value[key]])
  ) as unknown as TicketAccess;
}

// Thông tin cá nhân của CHÍNH người hỏi, hoặc null nếu không cấu hình/không có danh tính. Không bao giờ ném lỗi:
// tra thất bại hay quá hạn → `leaveBalanceDays: null` (prompt ghi "chưa tra được") để câu trả lời vẫn chạy.
async function loadPersonalContext(
  deps: HandbookAssistantDeps,
  ctx: RunContext
): Promise<PersonalContext | null> {
  const provider = deps.personalContext;
  const { userInfoId } = ctx;
  if (!provider || !userInfoId) return null;
  // Tra lỗi / quá hạn: cả hai đều "chưa tra được" (ticketAccess null ≠ undefined: prompt ghi rõ chưa tra được quyền
  // thay vì im lặng, để trợ lý không tự cho là có hay không có quyền).
  const unavailable: PersonalContext = { leaveBalanceDays: null, ticketAccess: null };
  const result = await lookupWithTimeout(
    () => provider.getForAsker({ accountId: ctx.accountId, userInfoId }),
    unavailable,
    "thông tin cá nhân của người hỏi",
    ctx.messageId
  );
  const days = result?.leaveBalanceDays;
  return {
    leaveBalanceDays: typeof days === "number" && Number.isFinite(days) ? days : null,
    ticketAccess: sanitizeTicketAccess(result?.ticketAccess)
  };
}

// Dữ liệu tra cứu dùng chung (cấu hình ticket đang áp dụng), hoặc null nếu không cấu hình. Lỗi / quá hạn →
// `ticketConfig: null` (prompt ghi "chưa tra được") để câu trả lời vẫn chạy.
async function loadReferenceContext(
  deps: HandbookAssistantDeps,
  ctx: RunContext
): Promise<ReferenceContext | null> {
  const provider = deps.referenceContext;
  if (!provider) return null;
  const result = await lookupWithTimeout(
    () => provider.getCurrent(),
    { ticketConfig: null },
    "cấu hình ticket",
    ctx.messageId
  );
  const text = result?.ticketConfig;
  return { ticketConfig: typeof text === "string" && text.trim() ? text : null };
}

// Ticket cụ thể do CHÍNH người hỏi tạo mà câu hỏi nhắc tới (mã TK-... ở câu hỏi này, hoặc ở câu hỏi gần nhất trước đó
// của hội thoại). undefined = không có gì để tra (cổng chưa nối, không có danh tính, hoặc câu hỏi không nêu mã).
// Lỗi / quá hạn → "chưa tra được" (không ném lỗi). Danh tính chỉ lấy từ socket; mã chỉ để CHỌN trong ticket của họ.
async function loadOwnTickets(
  deps: HandbookAssistantDeps,
  ctx: RunContext,
  history: HistoryTurn[]
): Promise<OwnTicketsContext | undefined> {
  const provider = deps.ownTicketLookup;
  const { userInfoId } = ctx;
  if (!provider || !userInfoId) return undefined;
  const codes = findTicketCodes(
    ctx.question,
    history.map((turn) => turn.question)
  );
  if (!codes.length) return undefined;
  const unavailable: OwnTicketsContext = { status: "unavailable", codes };
  const result = await lookupWithTimeout<OwnTicketsContext>(
    async () => {
      const found = await provider.lookup({ accountId: ctx.accountId, userInfoId }, codes);
      return {
        status: "ok",
        briefs: Array.isArray(found?.briefs) ? found.briefs : [],
        notFoundCodes: Array.isArray(found?.notFoundCodes) ? found.notFoundCodes : []
      };
    },
    unavailable,
    "ticket do người hỏi tạo",
    ctx.messageId
  );
  return result;
}

type Outcome =
  | { kind: "done"; text: string; citations: CitationView[]; truncated: boolean }
  | { kind: "error"; code: "REFUSED" | "AI_UNAVAILABLE" | "CANCELLED"; partialText: string };

interface Watchdogs {
  start(): void;
  touch(): void;
  firstTextSeen(): void;
  stop(): void;
}

// Ba đồng hồ canh một câu trả lời, đều dẫn tới abort với lý do tương ứng (→ AI_UNAVAILABLE):
//  - idle: không nhận được SỰ KIỆN nào (kể cả ping/thinking) quá streamIdleMs;
//  - first_text: chưa có chữ đầu tiên sau firstTextMs (nhỏ hơn 90s web chờ);
//  - max_duration: tổng thời gian vượt maxDurationMs.
function createWatchdogs(
  config: HandbookAssistantConfig,
  abort: (reason: AbortReason) => void
): Watchdogs {
  let started = false;
  let idleTimer: NodeJS.Timeout | null = null;
  let firstTextTimer: NodeJS.Timeout | null = null;
  let maxTimer: NodeJS.Timeout | null = null;

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort("idle"), config.streamIdleMs);
  };

  return {
    start() {
      started = true;
      maxTimer = setTimeout(() => abort("max_duration"), config.maxDurationMs);
      firstTextTimer = setTimeout(() => abort("first_text"), config.firstTextMs);
      armIdle();
    },
    touch() {
      if (started) armIdle();
    },
    firstTextSeen() {
      if (firstTextTimer) clearTimeout(firstTextTimer);
      firstTextTimer = null;
    },
    stop() {
      started = false;
      [idleTimer, firstTextTimer, maxTimer].forEach((timer) => timer && clearTimeout(timer));
      idleTimer = null;
      firstTextTimer = null;
      maxTimer = null;
    }
  };
}

interface DecideInput {
  result: AnswerResult | null;
  abortReason: AbortReason | null;
  emitted: string;
  articles: PromptArticle[];
  versionNo: number;
}

// Quy kết quả cuối cùng của một câu trả lời về đúng MỘT trạng thái (xem bảng mã lỗi hợp đồng web).
function decideOutcome({
  result,
  abortReason,
  emitted,
  articles,
  versionNo
}: DecideInput): Outcome {
  if (abortReason === "refused") return { kind: "error", code: "REFUSED", partialText: "" };

  if (result) {
    // Hội thoại bị xoá giữa chừng: kết quả không còn chỗ để lưu → coi là đã hủy.
    if (abortReason === "deleted") return { kind: "error", code: "CANCELLED", partialText: "" };
    // Bộ lọc an toàn từ chối: bỏ phần chữ đã sinh.
    if (result.stopReason === "refusal") return { kind: "error", code: "REFUSED", partialText: "" };

    const stripped = stripRefusalSentinel(emitted);
    if (stripped.found && !stripped.text)
      return { kind: "error", code: "REFUSED", partialText: "" };
    // Model không trả chữ nào (vd. hết max_tokens ngay trong thinking) → không có gì để hiển thị.
    if (!stripped.text) return { kind: "error", code: "AI_UNAVAILABLE", partialText: "" };

    return {
      kind: "done",
      text: stripped.text,
      citations: mapCitations(result.citations, articles, versionNo),
      truncated: result.stopReason === "max_tokens"
    };
  }

  // Không có kết quả: bị hủy chủ động hoặc lỗi. Lỗi abort của SDK luôn được quy theo `abortReason`.
  if (abortReason === "cancelled" || abortReason === "deleted") {
    return { kind: "error", code: "CANCELLED", partialText: emitted };
  }
  return { kind: "error", code: "AI_UNAVAILABLE", partialText: emitted };
}

async function bestEffort(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.error(`Trợ lý Nội quy: ${label} thất bại`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function emitSafely(work: () => void): void {
  try {
    work();
  } catch (error) {
    logger.error("Trợ lý Nội quy: phát sự kiện socket thất bại", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

interface SettleMeta {
  model: string;
  stopReason: string | null;
  usage: AnswerUsage;
  ttftMs: number | null;
  latencyMs: number;
  abortReason: AbortReason | null;
  failureKind: string | null;
}

// ĐIỂM CHỐT duy nhất: ghi có điều kiện (chỉ khi tin vẫn `streaming`) → hoàn lượt (nếu hỏng) → phát
// sự kiện. Chỉ bên ghi thắng mới phát/hoàn lượt nên cancel/done/watchdog/quét câu treo đua nhau
// cũng không bao giờ phát 2 sự kiện kết thúc hay hoàn lượt 2 lần.
async function settle(
  deps: HandbookAssistantDeps,
  ctx: RunContext,
  outcome: Outcome,
  meta: SettleMeta,
  release: () => Promise<void>
): Promise<void> {
  const costUsd = estimateCostUsd(meta.model, meta.usage);
  const ai = {
    model: meta.model,
    stopReason: meta.stopReason,
    usage: meta.usage,
    costUsd,
    ttftMs: meta.ttftMs,
    latencyMs: meta.latencyMs
  };

  let update: FinishUpdate;
  if (outcome.kind === "done") {
    update = {
      status: "done",
      content: outcome.text,
      errorCode: null,
      citations: outcome.citations,
      truncated: outcome.truncated,
      ai
    };
  } else {
    update = {
      status: outcome.code === "CANCELLED" ? "cancelled" : "error",
      content: outcome.code === "REFUSED" ? "" : outcome.partialText,
      errorCode: outcome.code,
      // Chỉ lỗi phía hệ thống mới hoàn lượt; từ chối/hủy vẫn tính lượt đã dùng.
      quotaRefunded: outcome.code === "AI_UNAVAILABLE",
      ai
    };
  }

  const won = await chatRepo.finishAnswer(ctx.messageId, update);
  if (!won) {
    await release();
    // Hội thoại bị xoá nên tin không còn: vẫn phải báo để giao diện đang chờ kết thúc được.
    if (meta.abortReason === "deleted") {
      emitSafely(() =>
        deps.events.error(ctx.accountId, { messageId: ctx.messageId, code: "CANCELLED" })
      );
    }
    return;
  }

  // Thứ tự quan trọng: sự kiện kết thúc là việc CUỐI CÙNG người dùng thấy, nên khi web nhận được nó thì
  //  - hạn mức đã đúng (web tải lại hạn mức ngay khi nhận sự kiện lỗi) → hoàn lượt trước;
  //  - số liệu phụ đã ghi xong (không còn việc ghi nào chạy sau sự kiện);
  //  - slot BUSY + khoá Redis đã nhả → người dùng hỏi tiếp ngay cũng không bị BUSY oan.
  if (update.quotaRefunded) {
    await bestEffort("hoàn lượt hỏi", () => refundQuota(ctx.accountId, ctx.quotaDateKey));
  }
  await bestEffort("cập nhật thời điểm hội thoại", () =>
    chatRepo.touchConversation(ctx.conversationId, new Date())
  );
  await bestEffort("ghi nhận chi phí", () =>
    recordAnswerUsage(ctx.accountId, ctx.quotaDateKey, meta.usage, costUsd)
  );
  await release();

  emitSafely(() => {
    if (outcome.kind === "done") {
      deps.events.done(ctx.accountId, {
        messageId: ctx.messageId,
        text: outcome.text,
        citations: outcome.citations,
        truncated: outcome.truncated
      });
    } else {
      deps.events.error(ctx.accountId, { messageId: ctx.messageId, code: outcome.code });
    }
  });

  // Không ghi nội dung câu hỏi/trả lời vào log (dữ liệu của nhân viên).
  logger.info("Trợ lý Nội quy: kết thúc câu trả lời", {
    messageId: ctx.messageId,
    outcome: outcome.kind === "done" ? "done" : outcome.code,
    model: meta.model,
    stopReason: meta.stopReason,
    abortReason: meta.abortReason,
    failureKind: meta.failureKind,
    usage: meta.usage,
    costUsd,
    ttftMs: meta.ttftMs,
    latencyMs: meta.latencyMs
  });
}

// Vòng đời một câu trả lời SAU khi đã ack: gọi AI, stream chữ về web, rồi chốt. KHÔNG BAO GIỜ ném
// lỗi ra ngoài và luôn nhả slot/khoá ở `finally`.
export async function runAnswer(deps: HandbookAssistantDeps, ctx: RunContext): Promise<void> {
  const config = getHandbookAssistantConfig();
  const { entry } = ctx;
  const startedAt = Date.now();
  const filter = new RefusalSentinelFilter();
  const watchdogs = createWatchdogs(config, (reason) => deps.registry.abort(ctx.messageId, reason));

  let articles: PromptArticle[] = [];
  let emitted = "";
  let ttftMs: number | null = null;
  let result: AnswerResult | null = null;
  let failure: unknown = null;

  // Nhả slot + khoá busy đúng MỘT lần (settle gọi sớm, `finally` gọi lại để chắc chắn).
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    deps.registry.release(ctx.messageId);
    await bestEffort("nhả khoá busy", () => ctx.releaseLock());
  };

  const emitDelta = (text: string) => {
    if (!text) return;
    emitted += text;
    emitSafely(() => deps.events.delta(ctx.accountId, { messageId: ctx.messageId, text }));
  };

  try {
    entry.state = "streaming";

    // Hủy có thể tới ngay sau ack, trước cả khi gọi AI → kiểm tra trước mỗi bước tốn kém.
    if (!entry.controller.signal.aborted) {
      const [loadedArticles, messages, personal, reference] = await Promise.all([
        getPromptArticles(ctx.versionId),
        chatRepo.listFinishedMessages(ctx.conversationId),
        loadPersonalContext(deps, ctx),
        loadReferenceContext(deps, ctx)
      ]);
      articles = loadedArticles;
      const history = selectHistoryTurns(messages, ctx.userSeq);
      const ownTickets = entry.controller.signal.aborted
        ? undefined
        : await loadOwnTickets(deps, ctx, history);

      if (!entry.controller.signal.aborted) {
        watchdogs.start();
        result = await deps.answerer.answer(
          {
            articles,
            history,
            question: ctx.question,
            personal,
            reference,
            ownTickets,
            signal: entry.controller.signal
          },
          {
            onActivity: () => watchdogs.touch(),
            onTextDelta: (delta) => {
              if (entry.controller.signal.aborted) return;
              if (ttftMs === null) {
                ttftMs = Date.now() - startedAt;
                watchdogs.firstTextSeen();
              }
              const pushed = filter.push(delta);
              if (pushed.refused) {
                deps.registry.abort(ctx.messageId, "refused");
                return;
              }
              emitDelta(pushed.emit);
            }
          }
        );
        if (!entry.controller.signal.aborted) emitDelta(filter.end().emit);
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    watchdogs.stop();
  }

  try {
    const { abortReason } = entry;
    const outcome = decideOutcome({
      result,
      abortReason,
      emitted,
      articles,
      versionNo: ctx.versionNo
    });
    const failureInfo = failure instanceof AnswerFailure ? failure : null;
    if (failure && !abortReason) {
      logger.error("Trợ lý Nội quy: lỗi khi gọi AI", {
        messageId: ctx.messageId,
        kind: failureInfo?.kind ?? "internal",
        error: failure instanceof Error ? failure.message : String(failure)
      });
    }
    await settle(
      deps,
      ctx,
      outcome,
      {
        model: result?.model ?? config.model,
        stopReason: result?.stopReason ?? null,
        usage: result?.usage ?? failureInfo?.usage ?? emptyUsage(),
        ttftMs,
        latencyMs: Date.now() - startedAt,
        abortReason,
        failureKind: failureInfo?.kind ?? null
      },
      release
    );
  } catch (error) {
    // Không chốt được (DB lỗi): báo cho web kết thúc; tin vẫn `streaming` sẽ được cron quét + hoàn lượt.
    logger.error("Trợ lý Nội quy: không chốt được câu trả lời", {
      messageId: ctx.messageId,
      error: error instanceof Error ? error.message : String(error)
    });
    await release();
    emitSafely(() =>
      deps.events.error(ctx.accountId, { messageId: ctx.messageId, code: "AI_UNAVAILABLE" })
    );
  } finally {
    await release();
  }
}
