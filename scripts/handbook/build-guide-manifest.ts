/**
 * Dựng manifest từ file Markdown hướng dẫn sử dụng (mặc định docs/HUONG-DAN-DON-TU.md) để nạp vào Trợ
 * lý Nội quy như một văn bản riêng. Chỉ đọc/ghi file, KHÔNG đụng DB. Chạy:
 *   npx ts-node --transpile-only scripts/handbook/build-guide-manifest.ts --output=guide.manifest.json \
 *     [--input=docs/HUONG-DAN-DON-TU.md] [--code=HUONG_DAN_DON_TU] [--short="Hướng dẫn đơn từ"] \
 *     [--title="Hướng dẫn sử dụng chức năng Đơn từ trên vWork"] [--with-suggestions-of=noi-quy.manifest.json]
 * Sau đó: import-handbook.ts --manifest=guide.manifest.json (văn bản khác của bản hiệu lực được giữ
 * nguyên) rồi publish-handbook.ts.
 */
import fs from "fs";
import path from "path";
import { parseManifest } from "../../src/modules/handbook-assistant";
import { getArg, requireArg } from "./lib/cli";
import { mergeSuggestions, parseGuideMarkdown } from "./lib/guide-markdown";

function main(): void {
  const input = path.resolve(getArg("input") ?? "docs/HUONG-DAN-DON-TU.md");
  const output = path.resolve(requireArg("output"));
  const parsed = parseGuideMarkdown(fs.readFileSync(input, "utf8"), {
    documentCode: getArg("code") ?? "HUONG_DAN_DON_TU",
    documentTitle: getArg("title") ?? "Hướng dẫn sử dụng chức năng Đơn từ trên vWork",
    shortName: getArg("short") ?? "Hướng dẫn đơn từ",
    sourceFileName: path.basename(input)
  });

  const baseFile = getArg("with-suggestions-of");
  const existing: string[] = baseFile
    ? (JSON.parse(fs.readFileSync(path.resolve(baseFile), "utf8")).suggestions ?? [])
    : [];
  const manifest = {
    note: "Văn bản hướng dẫn sử dụng chức năng Đơn từ trên vWork (từ docs/HUONG-DAN-DON-TU.md)",
    suggestions: mergeSuggestions(existing, parsed.suggestions),
    documents: parsed.documents
  };

  // Kiểm tra bằng đúng bộ đọc manifest mà bước nạp sẽ dùng.
  const checked = parseManifest(manifest);
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  checked.documents.forEach((doc) =>
    console.log(
      `✅ ${doc.documentCode}: ${doc.articles.length} mục, ${doc.articles.reduce((n, a) => n + a.blocks.length, 0)} khối → ${output}`
    )
  );
  console.log(`   Gợi ý: ${manifest.suggestions.length} câu`);
}

try {
  main();
} catch (err) {
  console.error("❌ Lỗi:", (err as Error).message);
  process.exitCode = 1;
}
