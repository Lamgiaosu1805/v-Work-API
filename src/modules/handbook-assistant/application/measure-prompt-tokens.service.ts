import { NotFoundException } from "../../../core/exceptions/exceptions";
import { AnthropicHandbookAnswerer } from "../infrastructure/ai/anthropic-handbook-answerer";
import { handbookCatalogRepository as catalogRepo } from "../infrastructure/handbook-catalog.repository";
import { getPromptArticles } from "./prompt-articles.service";
import type { PromptArticle } from "./ports/handbook-answerer.port";

// Ngưỡng giá thấp của Haiku 5.5: prompt trên 100K token bị tính giá cao hơn khoảng 5 lần.
export const LOW_PRICE_TIER_TOKEN_LIMIT = 100_000;

export interface PromptTokenCounter {
  countPromptTokens(articles: PromptArticle[]): Promise<number>;
}

export interface MeasuredPromptTokens {
  versionNo: number;
  promptTokens: number;
  exceedsLowPriceTier: boolean;
}

// Đo token THẬT (count_tokens) của đúng prompt sẽ gửi cho một phiên bản và lưu vào `promptTokens` để
// quyết định có publish hay không. `counter` chỉ được truyền vào trong test.
export async function measureHandbookPromptTokens(
  versionNo: number,
  counter: PromptTokenCounter = new AnthropicHandbookAnswerer()
): Promise<MeasuredPromptTokens> {
  const version = await catalogRepo.findVersionByNo(versionNo);
  if (!version) throw new NotFoundException(`Không tìm thấy phiên bản ${versionNo}`);

  const promptTokens = await counter.countPromptTokens(await getPromptArticles(version._id));
  await catalogRepo.setPromptTokens(version._id, promptTokens);
  return {
    versionNo,
    promptTokens,
    exceedsLowPriceTier: promptTokens > LOW_PRICE_TIER_TOKEN_LIMIT
  };
}
