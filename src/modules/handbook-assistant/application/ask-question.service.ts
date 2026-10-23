import mongoose from "mongoose";
import { logger } from "../../../config/logger";
import { runInTransaction } from "../../../core/db/run-in-transaction";
import { HandbookAssistantError } from "../domain/handbook-assistant.errors";
import type { ReleaseLock } from "../infrastructure/busy-lock";
import { handbookCatalogRepository as catalogRepo } from "../infrastructure/handbook-catalog.repository";
import {
  MessageRecord,
  handbookChatRepository as chatRepo
} from "../infrastructure/handbook-chat.repository";
import { runAnswer } from "./answer-runner";
import type { HandbookAssistantDeps } from "./handbook-assistant.deps";
import { getHandbookAssistantConfig } from "./handbook-assistant.config";
import { ReservedQuota, refundQuota, reserveQuota } from "./quota.service";
import { toHandbookError } from "./to-handbook-error";

export const MAX_QUESTION_LENGTH = 1000;
const MAX_CLIENT_ID_LENGTH = 100;
const MAX_TITLE_LENGTH = 80;
// Khoá busy sống lâu hơn thời gian tối đa của một câu trả lời để không hết hạn giữa chừng, nhưng vẫn
// tự gỡ nếu tiến trình chết.
const LOCK_TTL_MARGIN_MS = 60_000;

export interface AskInput {
  accountId: string;
  conversationId: unknown;
  question: unknown;
  clientId: unknown;
}

export interface AcceptedAsk {
  conversationId: string;
  messageId: string;
  clientId: string;
  // Gọi SAU KHI đã ack + phát `handbook:start` để bắt đầu stream. Không bao giờ ném lỗi và luôn nhả
  // slot/khoá. Với lần hỏi trùng (replay) thì chỉ phát lại sự kiện kết thúc đã có.
  run(): Promise<void>;
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

function parseQuestion(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HandbookAssistantError("BAD_REQUEST", "Câu hỏi không hợp lệ");
  }
  const question = raw.normalize("NFC").trim();
  if (!question) throw new HandbookAssistantError("BAD_REQUEST", "Câu hỏi đang để trống");
  // Đếm theo đơn vị UTF-16 như `maxLength` của ô nhập trên web.
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new HandbookAssistantError("BAD_REQUEST", `Câu hỏi dài quá ${MAX_QUESTION_LENGTH} ký tự`);
  }
  return question;
}

function parseClientId(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_CLIENT_ID_LENGTH) {
    throw new HandbookAssistantError("BAD_REQUEST", "clientId không hợp lệ");
  }
  return raw;
}

// null = hội thoại mới. Id sai định dạng coi như hội thoại không dùng được (web chỉ gợi ý mở hội
// thoại mới), thay vì để lỗi cast của Mongo lọt ra.
function parseConversationId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !OBJECT_ID.test(raw)) {
    throw new HandbookAssistantError("CONVERSATION_LOCKED");
  }
  return raw;
}

function makeTitle(question: string): string {
  return Array.from(question.replace(/\s+/g, " ")).slice(0, MAX_TITLE_LENGTH).join("");
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

// Lần hỏi trùng clientId (vd. socket.io gửi lại emit bị đệm khi mất mạng): không tạo lượt mới, chỉ trả
// lại đúng messageId cũ và — nếu câu trả lời đã xong — phát lại sự kiện kết thúc để web không treo.
async function replayAsk(
  deps: HandbookAssistantDeps,
  accountId: string,
  clientId: string,
  userMessage: MessageRecord
): Promise<AcceptedAsk | null> {
  const assistant = await chatRepo.findMessageBySeq(userMessage.conversation, userMessage.seq + 1);
  if (!assistant || assistant.role !== "assistant") return null;

  return {
    conversationId: userMessage.conversation,
    messageId: assistant._id,
    clientId,
    async run() {
      if (assistant.status === "done") {
        deps.events.done(accountId, {
          messageId: assistant._id,
          text: assistant.content,
          citations: assistant.citations,
          truncated: assistant.truncated
        });
      } else if (assistant.status === "error" || assistant.status === "cancelled") {
        deps.events.error(accountId, {
          messageId: assistant._id,
          code:
            (assistant.errorCode as "AI_UNAVAILABLE" | "REFUSED" | "CANCELLED") ?? "AI_UNAVAILABLE"
        });
      }
      // `streaming`: câu trả lời vẫn đang chạy và sẽ phát sự kiện như bình thường.
    }
  };
}

interface TurnInput {
  accountId: string;
  requestedConversationId: string | null;
  question: string;
  clientId: string;
  assistantMessageId: string;
  quotaDateKey: string;
  activeVersionId: string;
  maxTurns: number;
  model: string;
  now: Date;
}

// Tạo hội thoại (hoặc tăng số lượt) + tin user + tin trả lời `streaming` trong MỘT giao dịch. Số lượt
// được tăng nguyên tử theo điều kiện nên 2 yêu cầu đua nhau không vượt được TURN_LIMIT.
async function createTurn(input: TurnInput): Promise<{ conversationId: string; userSeq: number }> {
  return runInTransaction(async () => {
    let conversationId: string;
    let turnCount: number;

    if (!input.requestedConversationId) {
      conversationId = await chatRepo.insertConversation({
        accountId: input.accountId,
        title: makeTitle(input.question),
        versionId: input.activeVersionId,
        now: input.now
      });
      turnCount = 1;
    } else {
      conversationId = input.requestedConversationId;
      const bumped = await chatRepo.bumpConversationTurn({
        conversationId,
        accountId: input.accountId,
        versionId: input.activeVersionId,
        maxTurns: input.maxTurns,
        now: input.now
      });
      if (!bumped) {
        // Điều kiện nào đó đã đổi giữa lúc kiểm tra và lúc ghi: xác định lại nguyên nhân.
        const current = await chatRepo.findOwnedConversation(conversationId, input.accountId);
        if (!current || current.version !== input.activeVersionId) {
          throw new HandbookAssistantError("CONVERSATION_LOCKED");
        }
        throw new HandbookAssistantError("TURN_LIMIT");
      }
      turnCount = bumped.turnCount;
    }

    // Lượt n: tin user seq 2n-1, tin trả lời seq 2n.
    const userSeq = turnCount * 2 - 1;
    await chatRepo.insertTurnMessages({
      conversationId,
      accountId: input.accountId,
      userSeq,
      question: input.question,
      clientId: input.clientId,
      assistantMessageId: input.assistantMessageId,
      quotaDateKey: input.quotaDateKey,
      model: input.model
    });
    return { conversationId, userSeq };
  });
}

// `handbook:ask` — phần TRƯỚC ack: kiểm tra → giữ chỗ → giữ hạn mức → lưu. Thứ tự mã lỗi:
// BAD_REQUEST → AI_UNAVAILABLE (chưa cấu hình) → NO_ACTIVE_HANDBOOK → CONVERSATION_LOCKED → TURN_LIMIT
// → BUSY → QUOTA_EXCEEDED. Thất bại ở bất kỳ bước nào đều hoàn tác những bước trước (nhả slot/khoá,
// hoàn lượt, chốt tin đã tạo thành lỗi). Quyền dùng tính năng do tầng socket kiểm tra trước.
export async function prepareAsk(
  deps: HandbookAssistantDeps,
  input: AskInput
): Promise<AcceptedAsk> {
  const config = getHandbookAssistantConfig();
  const now = deps.now ?? (() => new Date());
  const startedAt = Date.now();

  const question = parseQuestion(input.question);
  const clientId = parseClientId(input.clientId);
  const requestedConversationId = parseConversationId(input.conversationId);

  if (!deps.answerer.isConfigured()) {
    logger.error("Trợ lý Nội quy chưa được cấu hình API key");
    throw new HandbookAssistantError("AI_UNAVAILABLE");
  }

  const active = await catalogRepo.findActiveVersion();
  if (!active) throw new HandbookAssistantError("NO_ACTIVE_HANDBOOK");

  const duplicate = await chatRepo.findUserMessageByClientId(input.accountId, clientId);
  if (duplicate) {
    const replay = await replayAsk(deps, input.accountId, clientId, duplicate);
    if (replay) return replay;
  }

  if (requestedConversationId) {
    const conversation = await chatRepo.findOwnedConversation(
      requestedConversationId,
      input.accountId
    );
    if (!conversation || conversation.version !== active._id) {
      throw new HandbookAssistantError("CONVERSATION_LOCKED");
    }
    if (conversation.turnCount >= config.maxTurns) throw new HandbookAssistantError("TURN_LIMIT");
  }

  // Giữ chỗ ĐỒNG BỘ ngay sau khi qua kiểm tra: từ đây mọi yêu cầu khác của tài khoản này nhận BUSY.
  const messageId = new mongoose.Types.ObjectId().toString();
  const entry = deps.registry.tryClaim({
    messageId,
    accountId: input.accountId,
    maxConcurrent: config.maxConcurrent
  });
  if (!entry) throw new HandbookAssistantError("BUSY");

  let releaseLock: ReleaseLock | null = null;
  let reserved: ReservedQuota | null = null;
  let turnCreated = false;
  let failure: unknown;

  try {
    releaseLock = await deps.acquireBusyLock(
      input.accountId,
      config.maxDurationMs + LOCK_TTL_MARGIN_MS
    );
    if (!releaseLock) throw new HandbookAssistantError("BUSY");

    reserved = await reserveQuota(input.accountId, now());

    const turn = await createTurn({
      accountId: input.accountId,
      requestedConversationId,
      question,
      clientId,
      assistantMessageId: messageId,
      quotaDateKey: reserved.dateKey,
      activeVersionId: active._id,
      maxTurns: config.maxTurns,
      model: config.model,
      now: now()
    });
    turnCreated = true;

    // Web bỏ cuộc sau 15s chờ ack: nếu xử lý quá lâu thì hủy hẳn lượt này thay vì ack muộn rồi để câu
    // trả lời chạy "mồ côi" trong khi người dùng thấy lỗi và hỏi lại.
    if (Date.now() - startedAt > config.ackDeadlineMs) {
      throw new HandbookAssistantError("AI_UNAVAILABLE", "Hệ thống phản hồi quá chậm");
    }

    deps.registry.setConversation(messageId, turn.conversationId);
    const lock = releaseLock;
    const quota = reserved;
    return {
      conversationId: turn.conversationId,
      messageId,
      clientId,
      run: () =>
        runAnswer(deps, {
          entry,
          messageId,
          conversationId: turn.conversationId,
          accountId: input.accountId,
          question,
          versionId: active._id,
          versionNo: active.versionNo,
          userSeq: turn.userSeq,
          quotaDateKey: quota.dateKey,
          releaseLock: lock
        })
    };
  } catch (error) {
    failure = error;
  }

  // ---- Hoàn tác ----
  if (turnCreated) {
    try {
      await chatRepo.finishAnswer(messageId, {
        status: "error",
        errorCode: "AI_UNAVAILABLE",
        content: "",
        quotaRefunded: true
      });
    } catch (error) {
      logger.error("Trợ lý Nội quy: không chốt được tin sau khi hủy lượt hỏi", {
        messageId,
        error
      });
    }
  }
  if (reserved) {
    try {
      await refundQuota(input.accountId, reserved.dateKey);
    } catch (error) {
      logger.error("Trợ lý Nội quy: không hoàn được lượt hỏi", { messageId, error });
    }
  }
  deps.registry.release(messageId);
  if (releaseLock) await releaseLock();

  // Hai yêu cầu cùng clientId đua nhau: bên thua trả lại kết quả của bên thắng.
  if (isDuplicateKeyError(failure)) {
    const existing = await chatRepo.findUserMessageByClientId(input.accountId, clientId);
    const replay = existing && (await replayAsk(deps, input.accountId, clientId, existing));
    if (replay) return replay;
  }
  throw toHandbookError(failure);
}
