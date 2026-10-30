import { runInTransaction } from "../../../core/db/run-in-transaction";
import { logger } from "../../../config/logger";
import { ArgumentInvalidException, NotFoundException } from "../../../core/exceptions/exceptions";
import { handbookCatalogRepository as repo } from "../infrastructure/handbook-catalog.repository";

export interface PublishHandbookVersionInput {
  versionNo: number;
  // account _id của người publish (nếu có), lưu vào `publishedBy`.
  publishedBy?: string | null;
}

export interface PublishHandbookVersionResult {
  versionNo: number;
  previousActiveVersionNo: number | null;
  alreadyActive: boolean;
}

// Đưa một phiên bản (nháp, hoặc bản đã lưu trữ khi rollback) thành bản hiệu lực; bản đang hiệu lực
// chuyển sang archived — cả hai bước trong 1 giao dịch nên không bao giờ có 0 hoặc 2 bản active.
// Hội thoại cũ KHÔNG bị cập nhật ở đây: chúng bị khoá lười khi hỏi (version khác bản active).
export async function publishHandbookVersion(
  input: PublishHandbookVersionInput
): Promise<PublishHandbookVersionResult> {
  if (!Number.isInteger(input.versionNo) || input.versionNo < 1) {
    throw new ArgumentInvalidException("versionNo phải là số nguyên dương");
  }

  const result = await runInTransaction(async () => {
    const target = await repo.findVersionByNo(input.versionNo);
    if (!target) throw new NotFoundException(`Không tìm thấy phiên bản ${input.versionNo}`);

    const active = await repo.findActiveVersion();
    if (active && active._id === target._id) {
      return {
        versionNo: target.versionNo,
        previousActiveVersionNo: null,
        alreadyActive: true
      };
    }

    if ((await repo.countArticles(target._id)) === 0) {
      throw new ArgumentInvalidException(`Phiên bản ${target.versionNo} không có Điều nào`);
    }

    await repo.archiveActiveExcept(target._id);
    await repo.activate(target._id, input.publishedBy ?? null);
    return {
      versionNo: target.versionNo,
      previousActiveVersionNo: active ? active.versionNo : null,
      alreadyActive: false
    };
  });

  logger.info("Đã publish phiên bản văn bản nội quy", {
    ...result,
    publishedBy: input.publishedBy
  });
  return result;
}
