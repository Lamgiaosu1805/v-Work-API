import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";
import {
  handbookCatalogRepository as catalogRepo,
  HandbookArticleRecord,
  HandbookVersionRecord
} from "../infrastructure/handbook-catalog.repository";

export interface ArticleView {
  // Đúng chuỗi client gửi lên (có thể kèm "@phiên-bản") để khớp với khoá cache/citation phía web.
  documentCode: string;
  documentTitle: string;
  articleIdx: number;
  label: string;
  title: string;
  // Văn bản thuần, nguyên văn (các khoản/điểm nối bằng "\n") — web tô sáng đoạn trích khớp nguyên văn.
  content: string;
}

// "NOI_QUY" (bản đang hiệu lực) hoặc "NOI_QUY@3" (đúng phiên bản 3 — dùng cho trích dẫn của câu trả lời cũ).
const CODE_PATTERN = /^([A-Z][A-Z0-9_]{1,39})(?:@(\d{1,6}))?$/;
const IDX_PATTERN = /^\d{1,4}$/;

function toView(documentCode: string, article: HandbookArticleRecord): ArticleView {
  return {
    documentCode,
    documentTitle: article.documentTitle,
    articleIdx: article.articleIdx,
    label: article.label,
    title: article.title,
    content: article.content
  };
}

// Thứ tự tìm khi không chỉ định phiên bản: bản đang hiệu lực trước, rồi các bản đã lưu trữ từ mới
// tới cũ — để vẫn mở được Điều đã bị bỏ khỏi bản mới.
function searchOrder(versions: HandbookVersionRecord[]): HandbookVersionRecord[] {
  const active = versions.filter((v) => v.status === "active");
  const others = versions.filter((v) => v.status !== "active");
  return [...active, ...others];
}

// Use-case ĐỌC: nguyên văn một Điều/mục. Bản NHÁP chưa publish không bao giờ lộ ra ngoài.
export async function getArticle(rawCode: string, rawIdx: string): Promise<ArticleView> {
  const match = CODE_PATTERN.exec(rawCode);
  if (!match) throw new ArgumentInvalidException("documentCode không hợp lệ");
  if (!IDX_PATTERN.test(rawIdx)) throw new ArgumentInvalidException("articleIdx không hợp lệ");

  const [, documentCode, versionText] = match;
  const articleIdx = Number(rawIdx);

  const published = await catalogRepo.listPublishedVersions();
  const candidates = versionText
    ? published.filter((v) => v.versionNo === Number(versionText))
    : searchOrder(published);
  if (!candidates.length) throw new NotFoundException("Không tìm thấy điều khoản");

  const found = await catalogRepo.findArticlesOfVersions(
    candidates.map((v) => v._id),
    documentCode,
    articleIdx
  );
  const byVersion = new Map(found.map((article) => [article.version, article]));
  const hit = candidates.map((v) => byVersion.get(v._id)).find(Boolean);
  if (!hit) throw new NotFoundException("Không tìm thấy điều khoản");
  return toView(rawCode, hit);
}
