// Tách văn bản nội quy (đã làm sạch) thành các Điều, mỗi Điều thành các khoản/điểm (`blocks`).
// Hàm thuần, không phụ thuộc I/O — dùng cho script nạp văn bản. Kết quả luôn được người soát
// (P.HCNS) xem lại qua manifest, nên splitter ưu tiên báo `warnings` hơn là đoán bừa.

export interface SplitArticle {
  articleIdx: number;
  // "Điều 7. Thời giờ làm việc" (không có tiêu đề thì chỉ "Điều 7")
  title: string;
  // "Chương II. Thời giờ làm việc" — rỗng nếu văn bản không chia chương
  chapter: string;
  blocks: string[];
}

export interface SplitResult {
  articles: SplitArticle[];
  // Các đoạn nằm trước Điều đầu tiên (quốc hiệu, căn cứ...) — mặc định không đưa vào Trợ lý.
  preamble: string[];
  warnings: string[];
}

const ARTICLE_HEADING = /^(?:điều)\s+(\d{1,3})\s*([.:\-–—])?\s*(.*)$/iu;
const CHAPTER_HEADING = /^(?:chương)\s+([ivxlcdm]+|\d{1,3})\s*([.:\-–—])?\s*(.*)$/iu;
// Khoản "1." / "1)", khoản đánh số theo Điều "5.1." (có thể dính liền chữ, vd "5.1.Khối"), điểm "a)",
// gạch đầu dòng. Số theo Điều bắt buộc có dấu chấm cuối để không nhầm "0.5 ngày" đầu dòng.
const BLOCK_MARKER = /^(?:\d{1,3}\.\d{1,3}\.\s*|(?:\d{1,2}[.)]|[a-zđ]\)|[-•–])\s+)\S/u;
const SENTENCE_END = /[.;:!?…”"]$/u;
const MAX_TITLE_LENGTH = 150;
const MAX_CHAPTER_TITLE_LENGTH = 120;

const startsWithUppercase = (text: string): boolean => /^\p{Lu}/u.test(text);

// "Điều 5 của Nội quy này..." / "Chương 2 quy định..." nằm đầu dòng do PDF ngắt dòng là tham chiếu
// trong câu, không phải tiêu đề: tiêu đề thật có dấu phân cách hoặc phần còn lại viết hoa chữ đầu.
const isHeadingText = (separator: string | undefined, rest: string): boolean =>
  Boolean(separator) || !rest || startsWithUppercase(rest);

function nextNonEmptyIndex(lines: string[], from: number): number {
  let i = from;
  while (i < lines.length && !lines[i]) i += 1;
  return i;
}

// Dòng không rỗng kế tiếp bắt đầu bằng chữ thường: câu văn đang tiếp diễn, không phải tiêu đề.
function continuesInLowercase(lines: string[], from: number): boolean {
  const next = nextNonEmptyIndex(lines, from);
  if (next >= lines.length) return false;
  return /^\p{Ll}/u.test(lines[next]) && !BLOCK_MARKER.test(lines[next]);
}

function isStructuralLine(line: string): boolean {
  return ARTICLE_HEADING.test(line) || CHAPTER_HEADING.test(line) || BLOCK_MARKER.test(line);
}

export function splitArticles(rawText: string): SplitResult {
  const lines = rawText
    .normalize("NFC")
    .split(/\r?\n/)
    .map((line) => line.trim());

  const articles: SplitArticle[] = [];
  const warnings: string[] = [];
  const preamble: string[] = [];

  let chapter = "";
  let current: SplitArticle | null = null;
  // Mảng chứa khối đang mở (khối cuối mảng) — các dòng bị ngắt sẽ được nối vào khối này.
  let open: string[] | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line) {
      // Dòng trống kết thúc đoạn nếu câu đã kết thúc; ngược lại là ngắt dòng/ngắt trang giữa câu.
      if (open && SENTENCE_END.test(open[open.length - 1])) open = null;
      continue;
    }

    const chapterMatch = CHAPTER_HEADING.exec(line);
    if (chapterMatch && isHeadingText(chapterMatch[2], chapterMatch[3].trim())) {
      let chapterTitle = chapterMatch[3].trim();
      if (!chapterTitle) {
        const next = nextNonEmptyIndex(lines, i + 1);
        if (
          next < lines.length &&
          lines[next].length <= MAX_CHAPTER_TITLE_LENGTH &&
          !isStructuralLine(lines[next])
        ) {
          chapterTitle = lines[next];
          i = next;
        }
      }
      chapter = `Chương ${chapterMatch[1].toUpperCase()}${chapterTitle ? `. ${chapterTitle}` : ""}`;
      open = null;
      continue;
    }

    const headingMatch = ARTICLE_HEADING.exec(line);
    // "Điều 12" đứng một mình cuối dòng mà dòng sau viết thường là tham chiếu bị ngắt dòng.
    const isBareReference =
      headingMatch !== null &&
      !headingMatch[2] &&
      !headingMatch[3].trim() &&
      continuesInLowercase(lines, i + 1);
    if (
      headingMatch &&
      !isBareReference &&
      isHeadingText(headingMatch[2], headingMatch[3].trim())
    ) {
      const articleIdx = Number(headingMatch[1]);
      const last: number | null = articles.length ? articles[articles.length - 1].articleIdx : null;

      if (last !== null && articleIdx <= last) {
        // Tiêu đề lặp hoặc số Điều giảm: không mở Điều mới, giữ làm nội dung và báo để người soát.
        warnings.push(`Dòng "${line.slice(0, 60)}" có số Điều không lớn hơn Điều ${last}`);
      } else {
        if (last !== null && articleIdx > last + 1) {
          const missing =
            articleIdx - last - 1 === 1 ? `Điều ${last + 1}` : `Điều ${last + 1}–${articleIdx - 1}`;
          warnings.push(`Thiếu ${missing} (từ Điều ${last} nhảy sang Điều ${articleIdx})`);
        }

        let titleText = headingMatch[3].trim();
        if (!titleText) {
          const next = nextNonEmptyIndex(lines, i + 1);
          if (
            next < lines.length &&
            lines[next].length <= MAX_TITLE_LENGTH &&
            startsWithUppercase(lines[next]) &&
            !isStructuralLine(lines[next])
          ) {
            titleText = lines[next];
            i = next;
          }
        }
        current = {
          articleIdx,
          title: titleText ? `Điều ${articleIdx}. ${titleText}` : `Điều ${articleIdx}`,
          chapter,
          blocks: []
        };
        articles.push(current);
        open = null;
        continue;
      }
    }

    const target: string[] = current ? current.blocks : preamble;
    if (open && !BLOCK_MARKER.test(line)) {
      open[open.length - 1] = `${open[open.length - 1]} ${line}`;
    } else {
      target.push(line);
      open = target;
    }
  }

  articles.forEach((article) => {
    if (!article.blocks.length) warnings.push(`${article.title} không có nội dung`);
  });
  if (!articles.length) warnings.push("Không tìm thấy tiêu đề Điều nào trong văn bản");

  return { articles, preamble, warnings };
}
