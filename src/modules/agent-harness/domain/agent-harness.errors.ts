// Lỗi nghiệp vụ của agent harness — mã ổn định để web hiển thị đúng thông báo.
const MESSAGES = {
  FORBIDDEN: "Bạn không có quyền dùng trợ lý này",
  UNKNOWN_AGENT: "Trợ lý không tồn tại",
  INVALID_QUESTION: "Câu hỏi không hợp lệ",
  QUESTION_TOO_LONG: "Câu hỏi quá dài (tối đa 2.000 ký tự)",
  CONVERSATION_NOT_FOUND: "Không tìm thấy cuộc hội thoại",
  QUOTA_EXCEEDED: "Bạn đã dùng hết lượt hỏi hôm nay",
  BUSY: "Trợ lý đang trả lời câu trước, vui lòng chờ",
  NOT_CONFIGURED: "Trợ lý AI chưa được cấu hình",
  AI_FAILED: "Trợ lý chưa trả lời được, vui lòng thử lại",
  CANCELLED: "Đã dừng câu trả lời"
} as const;

export type AgentHarnessErrorCode = keyof typeof MESSAGES;

export class AgentHarnessError extends Error {
  readonly errorCode: AgentHarnessErrorCode;

  constructor(code: AgentHarnessErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.errorCode = code;
  }
}

export const toAgentHarnessError = (error: unknown): AgentHarnessError =>
  error instanceof AgentHarnessError ? error : new AgentHarnessError("AI_FAILED");
