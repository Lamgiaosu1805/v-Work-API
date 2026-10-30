/**
 * Publish một phiên bản văn bản nội quy (bản nháp, hoặc bản cũ để rollback) thành bản hiệu lực.
 * Bản đang hiệu lực chuyển sang lưu trữ; hội thoại cũ sẽ bị khoá (CONVERSATION_LOCKED) khi hỏi tiếp.
 *   npx ts-node scripts/handbook/publish-handbook.ts --version=3 [--by=<accountId>]
 */
import "dotenv/config";
import mongoose from "mongoose";
import { publishHandbookVersion } from "../../src/modules/handbook-assistant";
import { connectForHandbookScript } from "./lib/db";
import { getArg, requireArg } from "./lib/cli";

async function main(): Promise<void> {
  const versionNo = Number(requireArg("version"));
  await connectForHandbookScript();

  const result = await publishHandbookVersion({ versionNo, publishedBy: getArg("by") ?? null });
  if (result.alreadyActive) {
    console.log(`⏭  Phiên bản ${result.versionNo} đã là bản hiệu lực`);
    return;
  }
  console.log(
    `🎉 Đã publish phiên bản ${result.versionNo}${
      result.previousActiveVersionNo ? ` (bản ${result.previousActiveVersionNo} → lưu trữ)` : ""
    }`
  );
}

main()
  .catch((err) => {
    console.error("❌ Lỗi:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
