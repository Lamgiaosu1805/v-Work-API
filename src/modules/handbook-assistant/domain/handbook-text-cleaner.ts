// Làm sạch văn bản trích từ PDF trước khi tách Điều: chuẩn hoá Unicode, bỏ ký tự vô hình, bỏ số
// trang và header/footer lặp lại ở nhiều trang. Hàm thuần, không phụ thuộc I/O.

// Ký tự vô hình (zero-width, soft hyphen, BOM) dựng từ mã Unicode để file nguồn không chứa
// ký tự vô hình thật.
const INVISIBLE_CHARS = new RegExp(
  `[${[0x200b, 0x200c, 0x200d, 0x2060, 0x00ad, 0xfeff].map((c) => String.fromCharCode(c)).join("")}]`,
  "g"
);
const NON_BREAKING_SPACE = String.fromCharCode(0x00a0);
const PAGE_NUMBER =
  /^(?:trang\s+)?\d{1,4}(?:\s*(?:\/|trên|of)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;
const MAX_REPEATED_LINE_LENGTH = 120;

function normalizeLine(line: string): string {
  return line
    .normalize("NFC")
    .replace(INVISIBLE_CHARS, "")
    .replace(new RegExp(`[${NON_BREAKING_SPACE}\\t]`, "g"), " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

// Footer/header có kèm số trang ("Nội quy - Trang 3/10", "Nội quy | 3", "3 | Nội quy"): dòng khác nhau
// ở chữ số giữa các trang vẫn được coi là một dòng lặp. Dòng khác chỉ khác chữ số (vd. "Điều 5",
// "Nội dung 2") KHÔNG thuộc nhóm này nên không bao giờ bị xoá nhầm.
const PAGE_NUMBERED_LINE =
  /(?:\b(?:trang|page)\s+\d+(?:\s*(?:\/|trên|of)\s*\d+)?\s*$)|(?:[-–—|•·]\s*\d+\s*$)|(?:^\d+\s*[-–—|•·]\s)/iu;
const STRUCTURAL_HEADING = /^(?:điều|chương)\s+\d|^(?:điều|chương)\s+[ivxlcdm]+\b/iu;

function digitFreeKey(line: string): string | null {
  if (STRUCTURAL_HEADING.test(line) || !PAGE_NUMBERED_LINE.test(line)) return null;
  return line.replace(/\d+/g, "#").toLowerCase();
}

export function cleanExtractedPages(pages: string[]): string {
  const pageLines = pages.map((page) => page.split(/\r?\n/).map(normalizeLine));

  // Header/footer: dòng xuất hiện ở ít nhất một nửa số trang (tối thiểu 3 trang), hoặc dạng
  // "...Trang N" khác nhau giữa các trang.
  const exactRepeats = new Set<string>();
  const numberedRepeats = new Set<string>();
  if (pageLines.length >= 3) {
    const threshold = Math.max(3, Math.ceil(pageLines.length * 0.5));
    const exactCounts = new Map<string, number>();
    const numberedCounts = new Map<string, number>();
    pageLines.forEach((lines) => {
      const exactInPage = new Set<string>();
      const numberedInPage = new Set<string>();
      lines.forEach((line) => {
        if (!line || line.length > MAX_REPEATED_LINE_LENGTH || STRUCTURAL_HEADING.test(line))
          return;
        exactInPage.add(line);
        const key = digitFreeKey(line);
        if (key) numberedInPage.add(key);
      });
      exactInPage.forEach((line) => exactCounts.set(line, (exactCounts.get(line) ?? 0) + 1));
      numberedInPage.forEach((key) => numberedCounts.set(key, (numberedCounts.get(key) ?? 0) + 1));
    });
    exactCounts.forEach((count, line) => {
      if (count >= threshold) exactRepeats.add(line);
    });
    numberedCounts.forEach((count, key) => {
      if (count >= threshold) numberedRepeats.add(key);
    });
  }

  const isRepeated = (line: string): boolean => {
    if (exactRepeats.has(line)) return true;
    const key = digitFreeKey(line);
    return key !== null && numberedRepeats.has(key);
  };

  const kept: string[] = [];
  pageLines.forEach((lines) => {
    lines.forEach((line) => {
      if (line && (PAGE_NUMBER.test(line) || isRepeated(line))) return;
      kept.push(line);
    });
  });

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
