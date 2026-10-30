import { handbookCatalogRepository as catalogRepo } from "../infrastructure/handbook-catalog.repository";
import type { PromptArticle } from "./ports/handbook-answerer.port";

// Nội dung một phiên bản đã publish là BẤT BIẾN (import chỉ tạo bản nháp, publish chỉ đổi trạng thái)
// nên có thể nhớ theo id phiên bản mà không lo lỗi thời: publish bản mới = id mới = nạp lại.
const MAX_CACHED_VERSIONS = 3;
const cache = new Map<string, PromptArticle[]>();

export async function getPromptArticles(versionId: string): Promise<PromptArticle[]> {
  const hit = cache.get(versionId);
  if (hit) return hit;

  const articles = (await catalogRepo.findArticles(versionId)).map((article) => ({
    documentCode: article.documentCode,
    documentTitle: article.documentTitle,
    articleIdx: article.articleIdx,
    label: article.label,
    title: article.title,
    chapter: article.chapter,
    blocks: article.blocks
  }));

  cache.set(versionId, articles);
  while (cache.size > MAX_CACHED_VERSIONS) {
    cache.delete(cache.keys().next().value as string);
  }
  return articles;
}

// Chỉ dùng trong test.
export function clearPromptArticleCache(): void {
  cache.clear();
}
