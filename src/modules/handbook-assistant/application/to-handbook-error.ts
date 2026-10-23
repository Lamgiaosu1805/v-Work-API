import { logger } from "../../../config/logger";
import { ExceptionBase } from "../../../core/exceptions/exception.base";
import { HandbookAssistantError } from "../domain/handbook-assistant.errors";

// Mọi lỗi của luồng hỏi đều quy về một HandbookAssistantError có mã theo hợp đồng với web. Lỗi hạ tầng
// (Mongo xung đột/hết giờ...) thành AI_UNAVAILABLE — người dùng chỉ cần biết "thử lại sau" — và được
// log đầy đủ để điều tra.
export function toHandbookError(error: unknown): HandbookAssistantError {
  if (error instanceof HandbookAssistantError) return error;
  logger.error("Lỗi không lường trước ở Trợ lý Nội quy", {
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof ExceptionBase ? error.code : undefined,
    stack: error instanceof Error ? error.stack : undefined
  });
  return new HandbookAssistantError("AI_UNAVAILABLE");
}
