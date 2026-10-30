import { logger } from "../../../../config/logger";
import type { PromptArticle, RawCitation } from "../../application/ports/handbook-answerer.port";

export interface CitationView {
  // Kèm phiên bản ("NOI_QUY@3") để GET /articles mở đúng văn bản lúc trả lời, kể cả khi đã có bản mới.
  documentCode: string;
  documentTitle: string;
  label: string;
  articleIdx: number;
  citedText: string;
}

// Đổi vị trí trích dẫn của nhà cung cấp thành citation theo hợp đồng với web.
//  - `citedText` được dựng lại từ các khối [startBlock, endBlock) nối bằng "\n" — đúng cách `content`
//    của GET /articles được tạo — nên luôn là chuỗi con NGUYÊN VĂN của nội dung điều khoản (web tô sáng
//    bằng indexOf). Nếu dùng `cited_text` của API (các khối nối liền, không xuống dòng) thì trích dẫn
//    phủ nhiều khoản sẽ không khớp.
//  - Citation trỏ ra ngoài phạm vi hoặc sai chỉ số bị bỏ; trùng (cùng điều + cùng đoạn) chỉ giữ một.
export function mapCitations(
  raw: RawCitation[],
  articles: PromptArticle[],
  versionNo: number
): CitationView[] {
  const result: CitationView[] = [];
  const seen = new Set<string>();

  raw.forEach((citation) => {
    const article = articles[citation.documentIndex];
    const { startBlock, endBlock } = citation;
    const valid =
      article !== undefined &&
      Number.isInteger(startBlock) &&
      Number.isInteger(endBlock) &&
      startBlock >= 0 &&
      endBlock > startBlock &&
      endBlock <= article.blocks.length;
    if (!valid) {
      logger.warn("Bỏ citation không hợp lệ của Trợ lý Nội quy", {
        documentIndex: citation.documentIndex,
        startBlock,
        endBlock
      });
      return;
    }

    const citedText = article.blocks.slice(startBlock, endBlock).join("\n");
    const key = `${article.documentCode}#${article.articleIdx}#${citedText}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      documentCode: `${article.documentCode}@${versionNo}`,
      documentTitle: article.documentTitle,
      label: article.label,
      articleIdx: article.articleIdx,
      citedText
    });
  });

  return result;
}
