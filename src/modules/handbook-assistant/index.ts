// Public API module handbook-assistant (Trợ lý Nội quy — hỏi đáp nội quy bằng AI).
// Tiến độ theo giai đoạn: 1 = dữ liệu + nạp văn bản; 2 = REST; 3 = hỏi/stream qua socket (xong).
//
// LƯU Ý: file này được các script (scripts/handbook/*) nạp trực tiếp nên KHÔNG được kéo theo bất cứ thứ gì
// mở kết nối khi import (vd. config/redis). Vì vậy phần socket (`interface/handbook-assistant.socket`, dùng
// Redis + phân quyền) KHÔNG export ở đây — index.js nạp thẳng từ thư mục interface, giống router REST.
export { importHandbookDraft } from "./application/import-handbook.service";
export type {
  ImportHandbookInput,
  ImportHandbookResult
} from "./application/import-handbook.service";
export { publishHandbookVersion } from "./application/publish-handbook-version.service";
export type {
  PublishHandbookVersionInput,
  PublishHandbookVersionResult
} from "./application/publish-handbook-version.service";
export { splitArticles } from "./domain/article-splitter";
export type { SplitArticle, SplitResult } from "./domain/article-splitter";
export { cleanExtractedPages } from "./domain/handbook-text-cleaner";
export {
  parseManifest,
  defaultArticleLabel,
  DOCUMENT_CODE_PATTERN
} from "./domain/handbook-manifest";
export type {
  HandbookManifest,
  ManifestDocument,
  ManifestArticle
} from "./domain/handbook-manifest";
export {
  HandbookAssistantError,
  isHandbookAssistantError
} from "./domain/handbook-assistant.errors";
export type { HandbookErrorCode } from "./domain/handbook-assistant.errors";
export { shutdownHandbookAssistant } from "./application/shutdown-handbook-assistant";
export { recoverStaleAnswers as recoverStaleHandbookAnswers } from "./application/recover-stale-answers.service";
export { purgeExpiredConversations as purgeExpiredHandbookConversations } from "./application/purge-expired-conversations.service";
export { measureHandbookPromptTokens } from "./application/measure-prompt-tokens.service";
export type { MeasuredPromptTokens } from "./application/measure-prompt-tokens.service";
