/**
 * Nạp + publish BỘ VĂN BẢN MẪU (dữ liệu giả, KHÔNG phải nội quy thật) để dev/test Trợ lý Nội quy
 * cùng web khi tắt mock. Chỉ chạy ở môi trường dev:
 *   npx ts-node scripts/handbook/seed-sample-handbook.ts [--force]
 * Nếu đã có bản hiệu lực thì dừng, trừ khi có --force (tạo thêm phiên bản mới từ bộ mẫu).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { importHandbookDraft, publishHandbookVersion } from "../../src/modules/handbook-assistant";
import HandbookVersionModel from "../../src/models/HandbookVersionModel";
import { connectForHandbookScript } from "./lib/db";
import { hasFlag } from "./lib/cli";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Không nạp bộ văn bản MẪU ở môi trường production");
  }
  await connectForHandbookScript();

  const active = await HandbookVersionModel.findOne({ status: "active", isDeleted: false }).lean();
  if (active && !hasFlag("force")) {
    console.log(`⏭  Đã có bản hiệu lực số ${active.versionNo}; thêm --force để nạp lại bộ mẫu`);
    return;
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "sample-handbook.manifest.json"), "utf8")
  );
  const draft = await importHandbookDraft({ manifest, note: "Bộ văn bản mẫu (dev)" });
  await publishHandbookVersion({ versionNo: draft.versionNo });
  console.log(
    `🎉 Đã nạp + publish bộ mẫu thành phiên bản ${draft.versionNo} (${draft.totalArticles} mục)`
  );
}

main()
  .catch((err) => {
    console.error("❌ Lỗi:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
