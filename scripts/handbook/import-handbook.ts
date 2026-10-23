/**
 * Nạp manifest (đã soát) thành phiên bản NHÁP của văn bản nội quy. Chưa ảnh hưởng người dùng cho
 * tới khi chạy publish-handbook.ts. Chạy:
 *   npx ts-node scripts/handbook/import-handbook.ts --manifest=handbook.manifest.json \
 *     [--dry-run] [--drop=CODE1,CODE2] [--note="Cập nhật điều 12"] [--count-tokens]
 * Văn bản của bản đang hiệu lực mà manifest không có sẽ được giữ nguyên (trừ khi liệt kê ở --drop).
 * --dry-run chỉ kiểm tra manifest, không ghi DB. --count-tokens đo token THẬT của bản nháp bằng
 * count_tokens (cần HANDBOOK_ANTHROPIC_API_KEY/ANTHROPIC_API_KEY) và lưu vào bản nháp.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import {
  importHandbookDraft,
  measureHandbookPromptTokens,
  parseManifest
} from "../../src/modules/handbook-assistant";
import { connectForHandbookScript } from "./lib/db";
import { getArg, hasFlag, requireArg } from "./lib/cli";

async function main(): Promise<void> {
  const manifestPath = path.resolve(requireArg("manifest"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const dropDocumentCodes = (getArg("drop") ?? "").split(",").filter(Boolean);

  if (hasFlag("dry-run")) {
    const parsed = parseManifest(manifest);
    parsed.documents.forEach((doc) =>
      console.log(`  • ${doc.documentCode}: ${doc.articles.length} mục`)
    );
    console.log("✅ Manifest hợp lệ (dry-run, chưa ghi DB)");
    return;
  }

  await connectForHandbookScript();
  const result = await importHandbookDraft({
    manifest,
    dropDocumentCodes,
    note: getArg("note") ?? null
  });

  console.log(`\n🎉 Đã tạo bản NHÁP số ${result.versionNo} (${result.totalArticles} mục)`);
  result.documents.forEach((doc) =>
    console.log(
      `  • ${doc.documentCode}: ${doc.articleCount} mục${doc.carriedOver ? " (giữ nguyên từ bản cũ)" : ""}`
    )
  );
  console.log(`  ~${result.approxTokens} token (ước lượng thô, ${result.totalChars} ký tự)`);
  result.warnings.forEach((w) => console.warn(`⚠️  ${w}`));
  if (hasFlag("count-tokens")) {
    const measured = await measureHandbookPromptTokens(result.versionNo);
    console.log(`  🔢 ${measured.promptTokens} token (đo bằng count_tokens)`);
    if (measured.exceedsLowPriceTier) {
      console.warn("⚠️  Vượt 100K token: Haiku 5.5 tính giá cao hơn khoảng 5 lần cho mỗi câu hỏi.");
    }
  }
  console.log(
    `➡️  Publish: npx ts-node scripts/handbook/publish-handbook.ts --version=${result.versionNo}`
  );
}

main()
  .catch((err) => {
    console.error("❌ Lỗi:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
