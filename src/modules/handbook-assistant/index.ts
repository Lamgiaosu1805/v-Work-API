// Public API module handbook-assistant (Trợ lý Nội quy — hỏi đáp nội quy bằng AI).
// Tiến độ theo giai đoạn: 1 = dữ liệu + nạp văn bản (file này); 2 = REST; 3 = hỏi/stream qua socket.
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
