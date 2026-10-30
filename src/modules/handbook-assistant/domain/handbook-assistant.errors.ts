import { ExceptionBase, ExceptionOptions } from "../../../core/exceptions/exception.base";

// Mã lỗi theo hợp đồng với web (socket `handbook:error`, ack `ok:false`, REST). FORBIDDEN và
// BAD_REQUEST nằm ngoài hợp đồng 8 mã — web hiển thị chung là "Đã có lỗi xảy ra"; vẫn dùng để log.
export type HandbookErrorCode =
  | "QUOTA_EXCEEDED"
  | "BUSY"
  | "CONVERSATION_LOCKED"
  | "TURN_LIMIT"
  | "AI_UNAVAILABLE"
  | "REFUSED"
  | "CANCELLED"
  | "NO_ACTIVE_HANDBOOK"
  | "FORBIDDEN"
  | "BAD_REQUEST";

const HTTP_STATUS: Record<HandbookErrorCode, number> = {
  QUOTA_EXCEEDED: 429,
  BUSY: 429,
  CONVERSATION_LOCKED: 409,
  TURN_LIMIT: 409,
  AI_UNAVAILABLE: 503,
  REFUSED: 422,
  CANCELLED: 409,
  NO_ACTIVE_HANDBOOK: 404,
  FORBIDDEN: 403,
  BAD_REQUEST: 400
};

const DEFAULT_MESSAGE: Record<HandbookErrorCode, string> = {
  QUOTA_EXCEEDED: "Bạn đã hết lượt hỏi trong ngày",
  BUSY: "Trợ lý đang bận, vui lòng thử lại sau",
  CONVERSATION_LOCKED: "Hội thoại này không thể tiếp tục",
  TURN_LIMIT: "Hội thoại đã đạt số lượt hỏi tối đa",
  AI_UNAVAILABLE: "Trợ lý tạm thời không khả dụng",
  REFUSED: "Câu hỏi nằm ngoài phạm vi nội quy",
  CANCELLED: "Đã dừng trả lời",
  NO_ACTIVE_HANDBOOK: "Chưa có văn bản nội quy hiệu lực",
  FORBIDDEN: "Bạn không có quyền dùng Trợ lý Nội quy",
  BAD_REQUEST: "Yêu cầu không hợp lệ"
};

export class HandbookAssistantError extends ExceptionBase {
  readonly code: string;

  readonly statusCode: number;

  // Mã theo hợp đồng với web, dùng nguyên văn trong payload socket.
  readonly errorCode: HandbookErrorCode;

  constructor(errorCode: HandbookErrorCode, message?: string, options: ExceptionOptions = {}) {
    super(message ?? DEFAULT_MESSAGE[errorCode], options);
    this.errorCode = errorCode;
    this.code = `HANDBOOK.${errorCode}`;
    this.statusCode = HTTP_STATUS[errorCode];
  }
}

export function isHandbookAssistantError(error: unknown): error is HandbookAssistantError {
  return error instanceof HandbookAssistantError;
}
