/**
 * Trích văn bản nội quy từ PDF (có lớp chữ) → manifest JSON + bản xem trước .md để P.HCNS soát.
 * Không kết nối DB. Chạy:
 *   npx ts-node scripts/handbook/extract-handbook.ts \
 *     --input=noi-quy.pdf --code=NOI_QUY --title="Nội quy lao động" --short="Nội quy" \
 *     --out=handbook.manifest.json [--keep-preamble]
 * Chạy nhiều lần với cùng --out để gộp nhiều văn bản vào một manifest (cùng --code thì thay thế).
 * Cũng nhận file .txt (đã gõ/dán sẵn) thay cho PDF. Sau khi soát/sửa manifest, nạp bằng
 * scripts/handbook/import-handbook.ts. Văn bản thật KHÔNG được commit vào git: để PDF/manifest thật
 * trong scripts/handbook/private/ (đã nằm trong .gitignore).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  cleanExtractedPages,
  splitArticles,
  defaultArticleLabel,
  parseManifest,
  DOCUMENT_CODE_PATTERN,
  HandbookManifest,
  ManifestDocument
} from "../../src/modules/handbook-assistant";
import { hasFlag, requireArg } from "./lib/cli";
import { readPdfFile } from "./lib/pdf-reader";

async function loadPages(input: string): Promise<{ pages: string[]; sha256: string }> {
  if (input.toLowerCase().endsWith(".pdf")) return readPdfFile(input);
  const buffer = fs.readFileSync(input);
  return {
    pages: [buffer.toString("utf8")],
    sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

function renderPreview(
  manifest: HandbookManifest,
  warningsByCode: Record<string, string[]>
): string {
  const out: string[] = ["# Xem trước manifest nội quy — soát kỹ trước khi nạp", ""];
  manifest.documents.forEach((doc) => {
    out.push(`## ${doc.documentTitle} (${doc.documentCode}) — ${doc.articles.length} mục`, "");
    (warningsByCode[doc.documentCode] ?? []).forEach((w) => out.push(`> ⚠️ ${w}`));
    doc.articles.forEach((article) => {
      if (article.chapter) out.push(`_${article.chapter}_`);
      out.push(`### ${article.label} — ${article.title}`, "");
      article.blocks.forEach((block) => out.push(`- ${block}`));
      out.push("");
    });
  });
  return out.join("\n");
}

async function main(): Promise<void> {
  const input = requireArg("input");
  const documentCode = requireArg("code");
  const documentTitle = requireArg("title");
  const shortName = requireArg("short");
  const outPath = path.resolve(requireArg("out"));
  if (!DOCUMENT_CODE_PATTERN.test(documentCode)) {
    throw new Error(`--code chỉ gồm A-Z, 0-9, "_" (vd NOI_QUY), nhận: "${documentCode}"`);
  }

  const { pages, sha256 } = await loadPages(path.resolve(input));
  const { articles, preamble, warnings } = splitArticles(cleanExtractedPages(pages));
  if (!articles.length) {
    throw new Error(`Không tách được Điều nào. ${warnings.join("; ")}`);
  }

  const doc: ManifestDocument = {
    documentCode,
    documentTitle,
    shortName,
    sourceFileName: path.basename(input),
    sourceSha256: sha256,
    articles: articles.map((article) => ({
      articleIdx: article.articleIdx,
      title: article.title,
      label: defaultArticleLabel(shortName, article.articleIdx),
      chapter: article.chapter,
      blocks: article.blocks
    }))
  };
  if (hasFlag("keep-preamble") && preamble.length) {
    doc.articles.unshift({
      articleIdx: 0,
      title: "Phần mở đầu",
      label: `${shortName} – Phần mở đầu`,
      chapter: "",
      blocks: preamble
    });
  }

  const existing: HandbookManifest = fs.existsSync(outPath)
    ? parseManifest(JSON.parse(fs.readFileSync(outPath, "utf8")))
    : { documents: [], suggestions: [], note: null };
  const merged: HandbookManifest = {
    ...existing,
    documents: [...existing.documents.filter((d) => d.documentCode !== documentCode), doc]
  };
  parseManifest(merged); // chắc chắn file ghi ra nạp được

  fs.writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
  const previewPath = `${outPath.replace(/\.json$/i, "")}.preview.md`;
  fs.writeFileSync(previewPath, renderPreview(merged, { [documentCode]: warnings }));

  console.log(`✅ ${documentCode}: ${doc.articles.length} mục → ${outPath}`);
  console.log(`📝 Bản xem trước: ${previewPath}`);
  if (preamble.length && !hasFlag("keep-preamble")) {
    console.log(
      `ℹ️  Bỏ ${preamble.length} đoạn trước Điều đầu tiên (thêm --keep-preamble để giữ).`
    );
  }
  warnings.forEach((w) => console.warn(`⚠️  ${w}`));
  console.log("➡️  Soát manifest/preview, sửa tay nếu cần, rồi chạy import-handbook.ts.");
}

main().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
