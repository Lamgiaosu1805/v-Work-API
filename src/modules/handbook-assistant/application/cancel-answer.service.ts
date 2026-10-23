import mongoose from "mongoose";
import { logger } from "../../../config/logger";
import { handbookChatRepository as chatRepo } from "../infrastructure/handbook-chat.repository";
import type { HandbookAssistantDeps } from "./handbook-assistant.deps";

export interface CancelAnswerInput {
  accountId: string;
  messageId: unknown;
}

// `handbook:cancel` — hủy câu trả lời đang chạy. Chạy được từ BẤT KỲ tab nào của chính tài khoản đó.
//  - Còn trong registry: ghi lý do rồi abort; answer-runner tự chốt `cancelled` và phát CANCELLED.
//  - Không còn trong registry nhưng DB vẫn `streaming` của mình (mồ côi: tiến trình khác/đã chết):
//    chốt `cancelled` ngay và phát CANCELLED để web (chỉ chờ 5 giây) kết thúc được.
//  - Còn lại (id lạ, của người khác, đã xong): bỏ qua im lặng — không lộ thông tin.
export async function cancelAnswer(
  deps: HandbookAssistantDeps,
  input: CancelAnswerInput
): Promise<void> {
  const { messageId } = input;
  if (typeof messageId !== "string" || !/^[0-9a-fA-F]{24}$/.test(messageId)) return;

  const running = deps.registry.get(messageId);
  if (running) {
    if (running.accountId === input.accountId) deps.registry.abort(messageId, "cancelled");
    return;
  }

  const message = await chatRepo.findOwnedMessage(
    new mongoose.Types.ObjectId(messageId).toString(),
    input.accountId
  );
  if (!message || message.role !== "assistant" || message.status !== "streaming") return;

  const won = await chatRepo.finishAnswer(messageId, {
    status: "cancelled",
    errorCode: "CANCELLED",
    content: message.content
  });
  if (won) {
    logger.info("Đã chốt hủy câu trả lời mồ côi của Trợ lý Nội quy", { messageId });
    deps.events.error(input.accountId, { messageId, code: "CANCELLED" });
  }
}
