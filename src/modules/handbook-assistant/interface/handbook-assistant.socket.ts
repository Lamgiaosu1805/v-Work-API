import type { Server, Socket } from "socket.io";
import { canEmployee } from "../../../core/authorization/can-employee";
import { logger } from "../../../config/logger";
import { cancelAnswer } from "../application/cancel-answer.service";
import { prepareAsk } from "../application/ask-question.service";
import type {
  HandbookAssistantDeps,
  HandbookEventSink
} from "../application/handbook-assistant.deps";
import type { PersonalContextProvider } from "../application/ports/personal-context.port";
import { runningAnswers } from "../application/running-answers.registry";
import { toHandbookError } from "../application/to-handbook-error";
import { HandbookAssistantError } from "../domain/handbook-assistant.errors";
import { AnthropicHandbookAnswerer } from "../infrastructure/ai/anthropic-handbook-answerer";
import { acquireBusyLock } from "../infrastructure/busy-lock";

export const HANDBOOK_SOCKET_EVENTS = {
  ASK: "handbook:ask",
  CANCEL: "handbook:cancel",
  START: "handbook:start",
  DELTA: "handbook:delta",
  DONE: "handbook:done",
  ERROR: "handbook:error"
} as const;

const PERMISSION_ACTION = "handbook_assistant.use";
const PERMISSION_SUBJECT = "HandbookAssistant";

type Ack = (payload: unknown) => void;

// Các handler tự bắt lỗi; hàm này chỉ là lưới an toàn để một lỗi lọt ra không thành unhandled rejection.
function runDetached(work: Promise<unknown>, label: string): void {
  work.catch((error) => {
    logger.error(`Trợ lý Nội quy: lỗi không bắt được ở ${label}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

// Gọi ack ĐÚNG MỘT LẦN dù handler đi qua nhiều nhánh lỗi.
function onceAck(callback: unknown): Ack {
  let called = false;
  return (payload) => {
    if (called || typeof callback !== "function") return;
    called = true;
    callback(payload);
  };
}

// Sự kiện được phát vào room `account:<id>` (chatSocket cho mọi socket của tài khoản join room này) nên
// MỌI tab của người dùng đều nhận được; web bỏ qua messageId lạ.
export function createSocketEventSink(io: Server): HandbookEventSink {
  const room = (accountId: string) => io.to(`account:${accountId}`);
  return {
    start: (accountId, payload) => room(accountId).emit(HANDBOOK_SOCKET_EVENTS.START, payload),
    delta: (accountId, payload) => room(accountId).emit(HANDBOOK_SOCKET_EVENTS.DELTA, payload),
    done: (accountId, payload) => room(accountId).emit(HANDBOOK_SOCKET_EVENTS.DONE, payload),
    error: (accountId, payload) => room(accountId).emit(HANDBOOK_SOCKET_EVENTS.ERROR, payload)
  };
}

export function createDefaultDeps(
  io: Server,
  personalContext?: PersonalContextProvider
): HandbookAssistantDeps {
  return {
    answerer: new AnthropicHandbookAnswerer(),
    events: createSocketEventSink(io),
    registry: runningAnswers,
    acquireBusyLock,
    personalContext
  };
}

async function handleAsk(
  deps: HandbookAssistantDeps,
  socket: Socket,
  payload: unknown,
  callback: unknown
): Promise<void> {
  const reply = onceAck(callback);
  const { accountId, userInfoId } = socket.data as { accountId?: string; userInfoId?: string };
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  let accepted: Awaited<ReturnType<typeof prepareAsk>> | null = null;

  try {
    // Socket không kèm token hợp lệ vẫn kết nối được (feed/post) nhưng không có accountId.
    if (!accountId || !userInfoId) throw new HandbookAssistantError("FORBIDDEN");
    if (!(await canEmployee(userInfoId, PERMISSION_ACTION, PERMISSION_SUBJECT))) {
      throw new HandbookAssistantError("FORBIDDEN");
    }

    // Danh tính (accountId/userInfoId) chỉ lấy từ socket đã xác thực — KHÔNG đọc từ payload của client.
    accepted = await prepareAsk(deps, {
      accountId,
      userInfoId,
      conversationId: body.conversationId,
      question: body.question,
      clientId: body.clientId
    });

    // Thứ tự bắt buộc: ack → `handbook:start` (cùng tick) → mới tới delta. Cả hai cùng đi trên một
    // đường truyền nên web luôn nhận ack/start trước mọi delta.
    reply({ ok: true, conversationId: accepted.conversationId, messageId: accepted.messageId });
    deps.events.start(accountId, {
      clientId: accepted.clientId,
      conversationId: accepted.conversationId,
      messageId: accepted.messageId
    });
  } catch (error) {
    const handbookError = toHandbookError(error);
    reply({ ok: false, code: handbookError.errorCode, message: handbookError.message });
  } finally {
    // Đã nhận lượt hỏi thì LUÔN phải chạy (hoặc ít nhất chốt) để nhả slot/khoá, kể cả khi ack/start lỗi.
    if (accepted) runDetached(accepted.run(), "run");
  }
}

async function handleCancel(
  deps: HandbookAssistantDeps,
  socket: Socket,
  payload: unknown,
  callback: unknown
): Promise<void> {
  const reply = onceAck(callback);
  const { accountId } = socket.data as { accountId?: string };
  try {
    if (accountId) {
      const messageId =
        typeof payload === "object" && payload !== null
          ? (payload as Record<string, unknown>).messageId
          : undefined;
      await cancelAnswer(deps, { accountId, messageId });
    }
    reply({ ok: true });
  } catch (error) {
    logger.error("Trợ lý Nội quy: lỗi khi xử lý handbook:cancel", {
      error: error instanceof Error ? error.message : String(error)
    });
    reply({ ok: false });
  }
}

// Đăng ký `handbook:ask` / `handbook:cancel` cho mọi socket. Gọi SAU setupChatSocket(io) trong index.js:
// xác thực socket (socket.data.accountId/userInfoId, room account:<id>) do middleware của chatSocket
// đảm nhiệm. `deps` chỉ được truyền vào trong test; `personalContext` (tra số ngày phép của chính người hỏi)
// do index.js truyền vào từ tầng workflows/.
export function setupHandbookAssistantSocket(
  io: Server,
  deps?: HandbookAssistantDeps,
  personalContext?: PersonalContextProvider
): void {
  const resolved = deps ?? createDefaultDeps(io, personalContext);
  io.on("connection", (socket: Socket) => {
    socket.on(HANDBOOK_SOCKET_EVENTS.ASK, (payload: unknown, callback: unknown) => {
      runDetached(handleAsk(resolved, socket, payload, callback), "handbook:ask");
    });
    socket.on(HANDBOOK_SOCKET_EVENTS.CANCEL, (payload: unknown, callback: unknown) => {
      runDetached(handleCancel(resolved, socket, payload, callback), "handbook:cancel");
    });
  });
}
