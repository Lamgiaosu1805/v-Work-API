// Chuyển file Markdown hướng dẫn (docs/HUONG-DAN-DON-TU.md) thành manifest văn bản cho Trợ lý Nội quy.
// Quy ước của file (thuần, không đụng DB — test được riêng):
//  - "## Mục N. Tiêu đề" mở một mục (đơn vị trích dẫn); N phải tăng dần từ 1;
//  - mỗi dòng không rỗng trong mục là MỘT khối (trợ lý trích dẫn theo khối); dấu gạch đầu dòng đầu dòng bị bỏ;
//  - "## Câu hỏi gợi ý": mỗi dòng là một câu hỏi gợi ý;
//  - dòng tiêu đề "# ..." và chú thích <!-- ... --> không đưa vào nội dung.
import type {
  HandbookManifest,
  ManifestArticle
} from "../../../src/modules/handbook-assistant/domain/handbook-manifest";

export interface GuideOptions {
  documentCode: string;
  documentTitle: string;
  shortName: string;
  sourceFileName: string | null;
}

const ARTICLE_HEADING = /^##\s+Mục\s+(\d+)\.\s+(.+?)\s*$/u;
const SUGGESTIONS_HEADING = /^##\s+Câu hỏi gợi ý\s*$/u;
const OTHER_HEADING = /^#{1,6}\s/u;
const BULLET = /^[-*•]\s+/u;

function stripComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

export function parseGuideMarkdown(
  markdown: string,
  options: GuideOptions
): Pick<HandbookManifest, "documents" | "suggestions"> {
  const articles: ManifestArticle[] = [];
  const suggestions: string[] = [];
  let current: ManifestArticle | null = null;
  let inSuggestions = false;
  const problems: string[] = [];

  stripComments(markdown)
    .normalize("NFC")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return;
      const where = `dòng ${index + 1}`;

      const heading = ARTICLE_HEADING.exec(line);
      if (heading) {
        const idx = Number(heading[1]);
        const expected = articles.length + 1;
        if (idx !== expected) problems.push(`${where}: "Mục ${idx}" phải là "Mục ${expected}"`);
        current = {
          articleIdx: idx,
          title: heading[2],
          label: `${options.shortName} – Mục ${idx}`,
          chapter: "",
          blocks: []
        };
        articles.push(current);
        inSuggestions = false;
        return;
      }
      if (SUGGESTIONS_HEADING.test(line)) {
        current = null;
        inSuggestions = true;
        return;
      }
      if (OTHER_HEADING.test(line)) {
        // "# Tiêu đề" của cả tài liệu; các tiêu đề khác không được hỗ trợ trong nội dung.
        if (!line.startsWith("# ")) problems.push(`${where}: tiêu đề không được hỗ trợ: ${line}`);
        if (line.startsWith("# ")) {
          current = null;
          inSuggestions = false;
        }
        return;
      }

      const text = line.replace(BULLET, "").trim();
      if (inSuggestions) suggestions.push(text);
      else if (current) current.blocks.push(text);
      else problems.push(`${where}: nội dung nằm ngoài mục nào: ${text.slice(0, 40)}`);
    });

  articles.forEach((article) => {
    if (!article.blocks.length) problems.push(`Mục ${article.articleIdx} không có nội dung`);
  });
  if (!articles.length) problems.push('Không có mục nào ("## Mục N. Tiêu đề")');
  if (problems.length) throw new Error(`File hướng dẫn không hợp lệ:\n- ${problems.join("\n- ")}`);

  return {
    documents: [
      {
        documentCode: options.documentCode,
        documentTitle: options.documentTitle,
        shortName: options.shortName,
        sourceFileName: options.sourceFileName,
        sourceSha256: null,
        articles
      }
    ],
    suggestions
  };
}

// Danh sách gợi ý của manifest nạp vào THAY THẾ danh sách của bản đang hiệu lực (khi không rỗng), nên
// khi chỉ thêm văn bản mới phải giữ lại các gợi ý cũ: gợi ý cũ trước, gợi ý của hướng dẫn sau, bỏ trùng.
export function mergeSuggestions(existing: string[], added: string[], max = 12): string[] {
  const merged = [...new Set([...existing, ...added])];
  if (merged.length > max) {
    throw new Error(
      `Có ${merged.length} câu gợi ý, tối đa ${max}: bỏ bớt câu gợi ý cũ hoặc của hướng dẫn`
    );
  }
  return merged;
}
