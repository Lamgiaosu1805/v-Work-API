import {
  ArgumentInvalidException,
  ConflictException,
  NotFoundException
} from "../../../core/exceptions/exceptions";
import { handbookChatRepository as chatRepo } from "../infrastructure/handbook-chat.repository";

export const MAX_FEEDBACK_COMMENT_LENGTH = 1000;

export interface SubmitFeedbackInput {
  accountId: string;
  messageId: string;
  value: unknown;
  comment?: unknown;
}

export interface SubmitFeedbackResult {
  messageId: string;
  value: 1 | -1;
}

function parseValue(value: unknown): 1 | -1 {
  if (value === 1 || value === -1) return value;
  throw new ArgumentInvalidException("value chỉ nhận 1 (hữu ích) hoặc -1 (chưa tốt)");
}

// Góp ý trống/chỉ khoảng trắng coi như không gửi góp ý (không xoá góp ý đang có).
function parseComment(comment: unknown): string | null {
  if (comment === undefined || comment === null) return null;
  if (typeof comment !== "string") throw new ArgumentInvalidException("comment phải là chuỗi");
  const text = comment.normalize("NFC").trim();
  if (text.length > MAX_FEEDBACK_COMMENT_LENGTH) {
    throw new ArgumentInvalidException(`comment dài quá ${MAX_FEEDBACK_COMMENT_LENGTH} ký tự`);
  }
  return text || null;
}

// Đánh giá 👍/👎 một câu trả lời của chính mình. Gọi nhiều lần cho cùng một tin là upsert (web có
// thể gửi 👎 trước rồi 👎 kèm góp ý) — quy tắc giữ/xoá góp ý nằm ở repository.setFeedback.
export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  const value = parseValue(input.value);
  const comment = parseComment(input.comment);

  const message = await chatRepo.findOwnedMessage(input.messageId, input.accountId);
  if (!message) throw new NotFoundException("Không tìm thấy tin nhắn");
  if (message.role !== "assistant") {
    throw new ArgumentInvalidException("Chỉ đánh giá được câu trả lời của trợ lý");
  }
  if (message.status === "streaming") {
    throw new ConflictException("Câu trả lời chưa hoàn tất, chưa thể đánh giá");
  }

  const updated = await chatRepo.setFeedback(input.messageId, input.accountId, value, comment);
  // Tin bị xoá (hoặc chuyển trạng thái) đúng lúc giữa 2 bước.
  if (!updated) throw new NotFoundException("Không tìm thấy tin nhắn");
  return { messageId: input.messageId, value };
}
