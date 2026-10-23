import { ClientSession } from "mongoose";
import { RequestContextService } from "../../../core/context/request-context";
import HandbookVersionModel, { HandbookVersionStatus } from "../../../models/HandbookVersionModel";
import HandbookArticleModel from "../../../models/HandbookArticleModel";

// Danh mục văn bản nội quy (phiên bản + các Điều) là dữ liệu tham chiếu thuần, không có invariant
// riêng của aggregate nên repository làm việc trực tiếp với plain object thay vì dựng Entity.
// Session giao dịch tự được nhặt từ RequestContextService như MongooseRepositoryBase.

export interface HandbookDocumentSummary {
  documentCode: string;
  documentTitle: string;
  shortName: string;
  articleCount: number;
  sourceFileName: string | null;
  sourceSha256: string | null;
}

export interface HandbookVersionRecord {
  _id: string;
  versionNo: number;
  status: HandbookVersionStatus;
  documents: HandbookDocumentSummary[];
  suggestions: string[];
  promptTokens: number | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  note: string | null;
}

export interface HandbookArticleRecord {
  version: string;
  documentCode: string;
  documentTitle: string;
  articleIdx: number;
  label: string;
  title: string;
  chapter: string;
  content: string;
  blocks: string[];
  order: number;
}

export interface NewHandbookVersion {
  versionNo: number;
  documents: HandbookDocumentSummary[];
  suggestions: string[];
  note: string | null;
}

function toVersionRecord(doc: Record<string, any>): HandbookVersionRecord {
  return {
    _id: String(doc._id),
    versionNo: doc.versionNo,
    status: doc.status,
    documents: doc.documents ?? [],
    suggestions: doc.suggestions ?? [],
    promptTokens: doc.promptTokens ?? null,
    publishedAt: doc.publishedAt ?? null,
    publishedBy: doc.publishedBy ? String(doc.publishedBy) : null,
    note: doc.note ?? null
  };
}

function toArticleRecord(doc: Record<string, any>): HandbookArticleRecord {
  return {
    version: String(doc.version),
    documentCode: doc.documentCode,
    documentTitle: doc.documentTitle,
    articleIdx: doc.articleIdx,
    label: doc.label,
    title: doc.title,
    chapter: doc.chapter ?? "",
    content: doc.content,
    blocks: doc.blocks ?? [],
    order: doc.order
  };
}

export class HandbookCatalogRepository {
  // eslint-disable-next-line class-methods-use-this
  private get session(): ClientSession | null {
    return (RequestContextService.getTransactionSession() as ClientSession | undefined) ?? null;
  }

  async findActiveVersion(): Promise<HandbookVersionRecord | null> {
    const doc = await HandbookVersionModel.findOne({ status: "active", isDeleted: false })
      .session(this.session)
      .lean();
    return doc ? toVersionRecord(doc) : null;
  }

  async findVersionByNo(versionNo: number): Promise<HandbookVersionRecord | null> {
    const doc = await HandbookVersionModel.findOne({ versionNo, isDeleted: false })
      .session(this.session)
      .lean();
    return doc ? toVersionRecord(doc) : null;
  }

  // Các phiên bản đã từng được publish (active hoặc archived) — KHÔNG gồm bản nháp. Mới nhất trước.
  async listPublishedVersions(limit = 50): Promise<HandbookVersionRecord[]> {
    const docs = await HandbookVersionModel.find({
      status: { $in: ["active", "archived"] },
      isDeleted: false
    })
      .sort({ versionNo: -1 })
      .limit(limit)
      .session(this.session)
      .lean();
    return docs.map(toVersionRecord);
  }

  async findArticlesOfVersions(
    versionIds: string[],
    documentCode: string,
    articleIdx: number
  ): Promise<HandbookArticleRecord[]> {
    const docs = await HandbookArticleModel.find({
      version: { $in: versionIds },
      documentCode,
      articleIdx,
      isDeleted: false
    })
      .session(this.session)
      .lean();
    return docs.map(toArticleRecord);
  }

  async getMaxVersionNo(): Promise<number> {
    const doc = await HandbookVersionModel.findOne({})
      .sort({ versionNo: -1 })
      .select("versionNo")
      .session(this.session)
      .lean();
    return doc ? doc.versionNo : 0;
  }

  async createDraftVersion(input: NewHandbookVersion): Promise<HandbookVersionRecord> {
    const [doc] = await HandbookVersionModel.create(
      [{ ...input, status: "draft", promptTokens: null }],
      { session: this.session ?? undefined }
    );
    return toVersionRecord(doc.toObject());
  }

  async insertArticles(articles: HandbookArticleRecord[]): Promise<void> {
    if (!articles.length) return;
    await HandbookArticleModel.insertMany(articles, { session: this.session ?? undefined });
  }

  async findArticles(
    versionId: string,
    documentCodes?: string[]
  ): Promise<HandbookArticleRecord[]> {
    const filter: Record<string, unknown> = { version: versionId, isDeleted: false };
    if (documentCodes) filter.documentCode = { $in: documentCodes };
    const docs = await HandbookArticleModel.find(filter)
      .sort({ order: 1 })
      .session(this.session)
      .lean();
    return docs.map(toArticleRecord);
  }

  async countArticles(versionId: string): Promise<number> {
    return HandbookArticleModel.countDocuments({ version: versionId, isDeleted: false }).session(
      this.session
    );
  }

  // Chuyển mọi phiên bản đang active (trừ `exceptVersionId`) sang archived.
  async archiveActiveExcept(exceptVersionId: string): Promise<void> {
    await HandbookVersionModel.updateMany(
      { status: "active", isDeleted: false, _id: { $ne: exceptVersionId } },
      { $set: { status: "archived" } },
      { session: this.session ?? undefined }
    );
  }

  async activate(versionId: string, publishedBy: string | null): Promise<void> {
    await HandbookVersionModel.updateOne(
      { _id: versionId },
      { $set: { status: "active", publishedAt: new Date(), publishedBy } },
      { session: this.session ?? undefined }
    );
  }
}

export const handbookCatalogRepository = new HandbookCatalogRepository();
