import { logger } from "../../../config/logger";
import { runningAnswers } from "./running-answers.registry";
import type { RunningAnswersRegistry } from "./running-answers.registry";

// Khi server nhận SIGTERM/SIGINT: hủy mọi câu đang chạy rồi chờ chúng chốt xong (AI_UNAVAILABLE + hoàn
// lượt + báo web) trước khi ngắt DB — để không để lại tin `streaming` mồ côi mỗi lần deploy.
export async function shutdownHandbookAssistant(
  timeoutMs = 8000,
  registry: RunningAnswersRegistry = runningAnswers
): Promise<void> {
  const aborted = registry.abortAll("shutdown");
  if (!aborted) return;
  logger.warn("Đang dừng các câu trả lời Trợ lý Nội quy do tắt server", { aborted });
  await registry.waitAllFinished(timeoutMs);
}
