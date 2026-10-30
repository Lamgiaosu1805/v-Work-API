import fs from "fs";
import crypto from "crypto";

// Đọc chữ từ PDF theo từng trang bằng pdf-parse 1.x. Import thẳng `lib/pdf-parse.js` vì file gốc
// của gói chạy một đoạn debug đọc file thử khi được require trực tiếp.
// pdf-parse là devDependency vì chỉ script chạy tay dùng tới (scripts/ không nằm trong bản build).
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, import/extensions, import/no-extraneous-dependencies
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  data: Uint8Array,
  options: { pagerender: (page: PdfPage) => Promise<string> }
) => Promise<{ numpages: number }>;

interface PdfTextItem {
  str: string;
  transform: number[];
}

interface PdfPage {
  pageIndex: number;
  getTextContent: (options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }) => Promise<{ items: PdfTextItem[] }>;
}

// Dưới ngưỡng này (ký tự/trang) coi là PDF scan — không có lớp chữ để đọc.
const MIN_CHARS_PER_PAGE = 20;

export interface PdfPages {
  pages: string[];
  sha256: string;
}

// pdf.js 1.x chạy worker giả và nhân bản dữ liệu bằng `new Buffer(...)`; với Buffer nhỏ Node cấp phát
// từ pool dùng chung (byteOffset khác 0) còn pdf.js lại đọc `data.buffer` bỏ qua byteOffset → đọc
// nhầm vùng nhớ ("bad XRef entry", tuỳ kích thước file). Đưa vào Uint8Array thuần có ArrayBuffer riêng.
function toPlainUint8Array(buffer: Buffer): Uint8Array {
  const copy = new Uint8Array(buffer.length);
  copy.set(buffer);
  return copy;
}

export async function readPdfPages(buffer: Buffer): Promise<PdfPages> {
  const pages: string[] = [];
  // pdf-parse nuốt lỗi từng trang (trả về chuỗi rỗng) nên tự ghi lại để báo đúng nguyên nhân.
  const pageErrors: string[] = [];

  await pdfParse(toPlainUint8Array(buffer), {
    pagerender: async (page) => {
      try {
        const content = await page.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false
        });
        let lastY: number | null = null;
        let text = "";
        content.items.forEach((item) => {
          const y = item.transform[5];
          if (lastY === null || lastY === y) text += item.str;
          else text += `\n${item.str}`;
          lastY = y;
        });
        pages[page.pageIndex] = text;
        return text;
      } catch (error) {
        pageErrors.push(`trang ${page.pageIndex + 1}: ${(error as Error).message}`);
        throw error;
      }
    }
  });

  if (pageErrors.length) {
    throw new Error(`Không đọc được PDF (${pageErrors.join("; ")})`);
  }
  const totalChars = pages.reduce((sum, page) => sum + (page ?? "").trim().length, 0);
  if (!pages.length || totalChars < MIN_CHARS_PER_PAGE * pages.length) {
    throw new Error(
      "PDF không có lớp chữ (có thể là bản scan). Hãy dùng bản Word/PDF xuất từ Word hoặc gõ lại."
    );
  }
  return {
    pages: Array.from(pages, (page) => page ?? ""),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

export async function readPdfFile(filePath: string): Promise<PdfPages> {
  return readPdfPages(fs.readFileSync(filePath));
}
