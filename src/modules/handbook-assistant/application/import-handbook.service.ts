import { runInTransaction } from "../../../core/db/run-in-transaction";
import { logger } from "../../../config/logger";
import { ArgumentInvalidException } from "../../../core/exceptions/exceptions";
import { parseManifest, ManifestDocument } from "../domain/handbook-manifest";
import {
  handbookCatalogRepository as repo,
  HandbookArticleRecord,
  HandbookDocumentSummary
} from "../infrastructure/handbook-catalog.repository";

// Cảnh báo khi bộ văn bản dài đến mức có thể vượt ngưỡng giá thấp (100K token) của Haiku 5.5.
// Ước lượng thô theo số ký tự; số liệu chính xác (count_tokens) được đo ở bước chạy thật.
const APPROX_CHARS_PER_TOKEN = 2.5;
const PRICE_TIER_TOKEN_LIMIT = 100_000;

export interface ImportHandbookInput {
  manifest: unknown;
  // Mã văn bản của bản đang hiệu lực KHÔNG đưa sang bản mới (mặc định mọi văn bản không có trong
  // manifest đều được giữ nguyên).
  dropDocumentCodes?: string[];
  note?: string | null;
}

export interface ImportHandbookResult {
  versionId: string;
  versionNo: number;
  documents: Array<{ documentCode: string; articleCount: number; carriedOver: boolean }>;
  totalArticles: number;
  totalChars: number;
  approxTokens: number;
  warnings: string[];
}

type ArticleWithoutVersion = Omit<HandbookArticleRecord, "version">;

function toArticleRecords(doc: ManifestDocument, firstOrder: number): ArticleWithoutVersion[] {
  return doc.articles.map((article, index) => ({
    documentCode: doc.documentCode,
    documentTitle: doc.documentTitle,
    articleIdx: article.articleIdx,
    label: article.label,
    title: article.title,
    chapter: article.chapter,
    content: article.blocks.join("\n"),
    blocks: article.blocks,
    order: firstOrder + index
  }));
}

// Tạo phiên bản NHÁP từ manifest. Văn bản của bản đang hiệu lực mà manifest không nhắc tới được
// sao chép sang; văn bản trùng mã được thay thế. Thứ tự văn bản ổn định giữa các phiên bản (văn bản
// cũ giữ vị trí, văn bản mới thêm vào cuối) để prompt dựng ra không bị xáo trộn.
export async function importHandbookDraft(
  input: ImportHandbookInput
): Promise<ImportHandbookResult> {
  const manifest = parseManifest(input.manifest);
  const dropCodes = new Set(input.dropDocumentCodes ?? []);
  const incoming = new Map(manifest.documents.map((doc) => [doc.documentCode, doc]));

  const result = await runInTransaction(async () => {
    const active = await repo.findActiveVersion();
    const activeDocs = active?.documents ?? [];
    const activeCodes = activeDocs.map((doc) => doc.documentCode);

    dropCodes.forEach((code) => {
      if (!activeCodes.includes(code)) {
        throw new ArgumentInvalidException(
          `Không có văn bản "${code}" trong bản đang hiệu lực để bỏ`
        );
      }
      if (incoming.has(code)) {
        throw new ArgumentInvalidException(`Văn bản "${code}" vừa bị bỏ vừa có trong manifest`);
      }
    });

    const carryCodes = activeCodes.filter((code) => !incoming.has(code) && !dropCodes.has(code));
    const carried =
      active && carryCodes.length ? await repo.findArticles(active._id, carryCodes) : [];
    const carriedByCode = new Map<string, HandbookArticleRecord[]>();
    carried.forEach((article) => {
      carriedByCode.set(article.documentCode, [
        ...(carriedByCode.get(article.documentCode) ?? []),
        article
      ]);
    });

    const orderedCodes = [
      ...activeCodes.filter((code) => !dropCodes.has(code)),
      ...manifest.documents
        .map((doc) => doc.documentCode)
        .filter((code) => !activeCodes.includes(code))
    ];

    const summaries: HandbookDocumentSummary[] = [];
    const articles: ArticleWithoutVersion[] = [];
    const report: ImportHandbookResult["documents"] = [];

    orderedCodes.forEach((code) => {
      const fresh = incoming.get(code);
      if (fresh) {
        articles.push(...toArticleRecords(fresh, articles.length));
        summaries.push({
          documentCode: code,
          documentTitle: fresh.documentTitle,
          shortName: fresh.shortName,
          articleCount: fresh.articles.length,
          sourceFileName: fresh.sourceFileName,
          sourceSha256: fresh.sourceSha256
        });
        report.push({
          documentCode: code,
          articleCount: fresh.articles.length,
          carriedOver: false
        });
        return;
      }
      const copies = carriedByCode.get(code) ?? [];
      const previous = activeDocs.find(
        (doc) => doc.documentCode === code
      ) as HandbookDocumentSummary;
      copies.forEach((article) => {
        const { version: _version, ...rest } = article;
        articles.push({ ...rest, order: articles.length });
      });
      summaries.push({ ...previous, articleCount: copies.length });
      report.push({ documentCode: code, articleCount: copies.length, carriedOver: true });
    });

    const draft = await repo.createDraftVersion({
      versionNo: (await repo.getMaxVersionNo()) + 1,
      documents: summaries,
      suggestions: manifest.suggestions.length ? manifest.suggestions : (active?.suggestions ?? []),
      note: input.note ?? manifest.note
    });
    await repo.insertArticles(articles.map((article) => ({ ...article, version: draft._id })));

    const totalChars = articles.reduce((sum, article) => sum + article.content.length, 0);
    return { draft, report, articleCount: articles.length, totalChars };
  });

  const approxTokens = Math.ceil(result.totalChars / APPROX_CHARS_PER_TOKEN);
  const warnings: string[] = [];
  if (approxTokens > PRICE_TIER_TOKEN_LIMIT) {
    warnings.push(
      `Bộ văn bản ước tính ~${approxTokens} token, có thể vượt ngưỡng ${PRICE_TIER_TOKEN_LIMIT} token ` +
        "(Haiku 5.5 tính giá cao hơn ~5 lần). Hãy đo bằng count_tokens trước khi publish."
    );
  }

  logger.info("Đã nạp bản nháp văn bản nội quy", {
    versionNo: result.draft.versionNo,
    documents: result.report,
    articles: result.articleCount,
    totalChars: result.totalChars
  });

  return {
    versionId: result.draft._id,
    versionNo: result.draft.versionNo,
    documents: result.report,
    totalArticles: result.articleCount,
    totalChars: result.totalChars,
    approxTokens,
    warnings
  };
}
