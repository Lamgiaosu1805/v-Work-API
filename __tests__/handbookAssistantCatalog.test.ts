import mongoose from "mongoose";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
/* eslint-disable import/first */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  importHandbookDraft,
  publishHandbookVersion,
  HandbookManifest
} from "../src/modules/handbook-assistant";
import { handbookCatalogRepository } from "../src/modules/handbook-assistant/infrastructure/handbook-catalog.repository";
import HandbookVersionModel from "../src/models/HandbookVersionModel";
import HandbookArticleModel from "../src/models/HandbookArticleModel";
import HandbookConversationModel from "../src/models/HandbookConversationModel";
import HandbookMessageModel from "../src/models/HandbookMessageModel";
import HandbookUsageModel from "../src/models/HandbookUsageModel";
import { ArgumentInvalidException, NotFoundException } from "../src/core/exceptions/exceptions";
import sampleManifest from "../scripts/handbook/sample-handbook.manifest.json";
/* eslint-enable import/first */

let replset: MongoMemoryReplSet;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const models: mongoose.Model<any>[] = [
  HandbookVersionModel,
  HandbookArticleModel,
  HandbookConversationModel,
  HandbookMessageModel,
  HandbookUsageModel
];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  // Chờ build xong index (unique/partial) trước khi test ràng buộc.
  await Promise.all(models.map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
  jest.restoreAllMocks();
});

const oid = () => new mongoose.Types.ObjectId();

describe("Model + index", () => {
  it("chỉ cho phép 1 phiên bản active; versionNo là duy nhất", async () => {
    await HandbookVersionModel.create({ versionNo: 1, status: "active" });
    await expect(
      HandbookVersionModel.create({ versionNo: 2, status: "active" })
    ).rejects.toMatchObject({
      code: 11000
    });
    await HandbookVersionModel.create({ versionNo: 2, status: "draft" });
    await HandbookVersionModel.create({ versionNo: 3, status: "archived" });
    await HandbookVersionModel.create({ versionNo: 4, status: "archived" });
    await expect(
      HandbookVersionModel.create({ versionNo: 2, status: "draft" })
    ).rejects.toMatchObject({
      code: 11000
    });
  });

  it("Điều là duy nhất trong {version, documentCode, articleIdx}", async () => {
    const version = oid();
    const base = {
      version,
      documentCode: "NOI_QUY",
      documentTitle: "Nội quy",
      articleIdx: 7,
      label: "Nội quy – Điều 7",
      title: "Điều 7",
      content: "x",
      blocks: ["x"],
      order: 0
    };
    await HandbookArticleModel.create(base);
    await expect(HandbookArticleModel.create({ ...base, order: 1 })).rejects.toMatchObject({
      code: 11000
    });
    await HandbookArticleModel.create({ ...base, documentCode: "BAC_PHAT" });
    await HandbookArticleModel.create({ ...base, version: oid() });
  });

  it("tin nhắn: seq duy nhất trong hội thoại; clientId chống gửi trùng chỉ khi có clientId", async () => {
    const conversation = oid();
    const account = oid();
    const base = { conversation, account, role: "user", content: "hỏi" };
    await HandbookMessageModel.create({ ...base, seq: 1, clientId: "c1" });
    await expect(HandbookMessageModel.create({ ...base, seq: 1 })).rejects.toMatchObject({
      code: 11000
    });
    await expect(
      HandbookMessageModel.create({ ...base, seq: 2, clientId: "c1" })
    ).rejects.toMatchObject({
      code: 11000
    });
    // tin trả lời không có clientId: nhiều tin cùng account không đụng index
    await HandbookMessageModel.create({ ...base, seq: 2, role: "assistant" });
    await HandbookMessageModel.create({ ...base, seq: 3, role: "assistant" });
    // clientId trùng nhưng khác account thì được
    await HandbookMessageModel.create({
      ...base,
      conversation: oid(),
      account: oid(),
      seq: 1,
      clientId: "c1"
    });
  });

  it("tin nhắn: feedback chỉ nhận 1, -1, null; mặc định errorCode null", async () => {
    const base = { conversation: oid(), account: oid(), role: "assistant", seq: 1 };
    const ok = await HandbookMessageModel.create({ ...base, feedback: -1 });
    expect(ok.errorCode).toBeNull();
    expect(ok.feedback).toBe(-1);
    await expect(HandbookMessageModel.create({ ...base, seq: 2, feedback: 5 })).rejects.toThrow(
      /feedback/
    );
    const none = await HandbookMessageModel.create({ ...base, seq: 3 });
    expect(none.feedback).toBeNull();
  });

  it("usage: một dòng mỗi {account, dateKey}; dateKey phải đúng dạng YYYY-MM-DD", async () => {
    const account = oid();
    await HandbookUsageModel.create({ account, dateKey: "2026-10-23" });
    await expect(
      HandbookUsageModel.create({ account, dateKey: "2026-10-23" })
    ).rejects.toMatchObject({
      code: 11000
    });
    await expect(HandbookUsageModel.create({ account, dateKey: "23/10/2026" })).rejects.toThrow();
  });
});

describe("importHandbookDraft", () => {
  it("nạp bộ mẫu thành bản nháp số 1 với đúng dữ liệu", async () => {
    const result = await importHandbookDraft({ manifest: clone(sampleManifest) });

    expect(result.versionNo).toBe(1);
    expect(result.totalArticles).toBe(7);
    expect(result.documents).toEqual([
      { documentCode: "NOI_QUY", articleCount: 5, carriedOver: false },
      { documentCode: "BAC_PHAT", articleCount: 2, carriedOver: false }
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.approxTokens).toBeGreaterThan(0);

    const version = await HandbookVersionModel.findById(result.versionId).lean();
    expect(version).toMatchObject({ versionNo: 1, status: "draft", promptTokens: null });
    expect(version?.suggestions).toHaveLength(3);
    expect(version?.documents.map((d) => [d.documentCode, d.articleCount])).toEqual([
      ["NOI_QUY", 5],
      ["BAC_PHAT", 2]
    ]);

    const articles = await HandbookArticleModel.find({ version: result.versionId })
      .sort({ order: 1 })
      .lean();
    expect(articles.map((a) => a.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(articles.map((a) => `${a.documentCode}#${a.articleIdx}`)).toEqual([
      "NOI_QUY#7",
      "NOI_QUY#8",
      "NOI_QUY#9",
      "NOI_QUY#12",
      "NOI_QUY#13",
      "BAC_PHAT#1",
      "BAC_PHAT#2"
    ]);
    const dieu7 = articles[0];
    expect(dieu7.label).toBe("Nội quy – Điều 7");
    expect(dieu7.title).toBe("Điều 7. Thời giờ làm việc");
    expect(dieu7.content).toBe(dieu7.blocks.join("\n"));
    expect(dieu7.blocks).toHaveLength(5);
    expect(articles[5].label).toBe("Bậc phạt – Đi muộn");
  });

  it("mỗi lần nạp tăng versionNo", async () => {
    const first = await importHandbookDraft({ manifest: clone(sampleManifest) });
    const second = await importHandbookDraft({ manifest: clone(sampleManifest) });
    expect([first.versionNo, second.versionNo]).toEqual([1, 2]);
    expect(await HandbookVersionModel.countDocuments({})).toBe(2);
    expect(await HandbookArticleModel.countDocuments({})).toBe(14);
  });

  it("manifest không hợp lệ: báo lỗi và không ghi gì", async () => {
    const bad = clone(sampleManifest) as unknown as HandbookManifest;
    bad.documents[0].documentCode = "sai ma";
    await expect(importHandbookDraft({ manifest: bad })).rejects.toBeInstanceOf(
      ArgumentInvalidException
    );
    expect(await HandbookVersionModel.countDocuments({})).toBe(0);
    expect(await HandbookArticleModel.countDocuments({})).toBe(0);
  });

  it("lỗi giữa chừng: rollback, không để lại bản nháp, versionNo không bị tiêu", async () => {
    jest
      .spyOn(handbookCatalogRepository, "insertArticles")
      .mockRejectedValueOnce(new Error("boom khi ghi Điều"));
    await expect(importHandbookDraft({ manifest: clone(sampleManifest) })).rejects.toThrow("boom");
    expect(await HandbookVersionModel.countDocuments({})).toBe(0);
    expect(await HandbookArticleModel.countDocuments({})).toBe(0);

    const retry = await importHandbookDraft({ manifest: clone(sampleManifest) });
    expect(retry.versionNo).toBe(1);
  });

  describe("khi đã có bản hiệu lực", () => {
    beforeEach(async () => {
      const v1 = await importHandbookDraft({ manifest: clone(sampleManifest) });
      await publishHandbookVersion({ versionNo: v1.versionNo });
    });

    it("giữ nguyên văn bản không có trong manifest, thay văn bản trùng mã, thứ tự ổn định", async () => {
      const manifest = clone(sampleManifest) as unknown as HandbookManifest;
      manifest.documents = [manifest.documents[0]];
      manifest.suggestions = [];
      manifest.documents[0].articles[1].blocks = ["1. Nội dung Điều 8 đã sửa."];

      const result = await importHandbookDraft({ manifest });

      expect(result.versionNo).toBe(2);
      expect(result.documents).toEqual([
        { documentCode: "NOI_QUY", articleCount: 5, carriedOver: false },
        { documentCode: "BAC_PHAT", articleCount: 2, carriedOver: true }
      ]);
      const articles = await HandbookArticleModel.find({ version: result.versionId })
        .sort({ order: 1 })
        .lean();
      expect(articles.map((a) => a.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(
        articles.find((a) => a.documentCode === "NOI_QUY" && a.articleIdx === 8)?.content
      ).toBe("1. Nội dung Điều 8 đã sửa.");
      const carried = articles.filter((a) => a.documentCode === "BAC_PHAT");
      expect(carried.map((a) => a.label)).toEqual([
        "Bậc phạt – Đi muộn",
        "Bậc phạt – Quên chấm công"
      ]);
      expect(carried[0].content).toContain("nhắc nhở");

      const version = await HandbookVersionModel.findById(result.versionId).lean();
      // manifest không có gợi ý → kế thừa từ bản hiệu lực
      expect(version?.suggestions).toHaveLength(3);
      expect(version?.documents.map((d) => d.documentCode)).toEqual(["NOI_QUY", "BAC_PHAT"]);
      // bản hiệu lực cũ không bị đụng tới
      expect((await HandbookVersionModel.findOne({ versionNo: 1 }).lean())?.status).toBe("active");
      expect(
        await HandbookArticleModel.countDocuments({
          version: (await HandbookVersionModel.findOne({ versionNo: 1 }))?._id
        })
      ).toBe(7);
    });

    it("văn bản mới thêm vào cuối, không xáo thứ tự văn bản cũ", async () => {
      const manifest = clone(sampleManifest) as unknown as HandbookManifest;
      manifest.documents = [
        {
          documentCode: "QUY_CHE_LUONG",
          documentTitle: "Quy chế lương",
          shortName: "Lương",
          sourceFileName: null,
          sourceSha256: null,
          articles: [
            {
              articleIdx: 1,
              title: "Điều 1",
              label: "Lương – Điều 1",
              chapter: "",
              blocks: ["1. x"]
            }
          ]
        }
      ];
      const result = await importHandbookDraft({ manifest });
      expect(result.documents.map((d) => d.documentCode)).toEqual([
        "NOI_QUY",
        "BAC_PHAT",
        "QUY_CHE_LUONG"
      ]);
      expect(result.totalArticles).toBe(8);
    });

    it("--drop bỏ văn bản khỏi bản mới", async () => {
      const manifest = clone(sampleManifest) as unknown as HandbookManifest;
      manifest.documents = [manifest.documents[0]];
      const result = await importHandbookDraft({ manifest, dropDocumentCodes: ["BAC_PHAT"] });
      expect(result.documents).toEqual([
        { documentCode: "NOI_QUY", articleCount: 5, carriedOver: false }
      ]);
      expect(
        await HandbookArticleModel.countDocuments({
          version: result.versionId,
          documentCode: "BAC_PHAT"
        })
      ).toBe(0);
    });

    it("--drop sai: mã không có trong bản hiệu lực, hoặc vừa drop vừa có trong manifest", async () => {
      const manifest = clone(sampleManifest) as unknown as HandbookManifest;
      await expect(
        importHandbookDraft({ manifest, dropDocumentCodes: ["KHONG_CO"] })
      ).rejects.toThrow(/Không có văn bản "KHONG_CO"/);
      await expect(
        importHandbookDraft({ manifest, dropDocumentCodes: ["NOI_QUY"] })
      ).rejects.toThrow(/vừa bị bỏ vừa có trong manifest/);
      expect(await HandbookVersionModel.countDocuments({})).toBe(1);
    });
  });

  it("--drop khi chưa có bản hiệu lực là lỗi", async () => {
    await expect(
      importHandbookDraft({ manifest: clone(sampleManifest), dropDocumentCodes: ["NOI_QUY"] })
    ).rejects.toThrow(/Không có văn bản "NOI_QUY"/);
  });

  it("cảnh báo khi bộ văn bản có thể vượt 100K token", async () => {
    const manifest = clone(sampleManifest) as unknown as HandbookManifest;
    manifest.documents = [manifest.documents[0]];
    manifest.documents[0].articles = [
      {
        articleIdx: 1,
        title: "Điều 1. Rất dài",
        label: "Nội quy – Điều 1",
        chapter: "",
        blocks: ["x".repeat(260_000)]
      }
    ];
    const result = await importHandbookDraft({ manifest });
    expect(result.approxTokens).toBeGreaterThan(100_000);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("count_tokens");
  });
});

describe("publishHandbookVersion", () => {
  const importDraft = () => importHandbookDraft({ manifest: clone(sampleManifest) });

  it("publish bản nháp đầu tiên: active, có publishedAt/publishedBy", async () => {
    const draft = await importDraft();
    const by = oid().toString();
    const result = await publishHandbookVersion({ versionNo: draft.versionNo, publishedBy: by });

    expect(result).toEqual({ versionNo: 1, previousActiveVersionNo: null, alreadyActive: false });
    const version = await HandbookVersionModel.findOne({ versionNo: 1 }).lean();
    expect(version?.status).toBe("active");
    expect(version?.publishedAt).toBeInstanceOf(Date);
    expect(String(version?.publishedBy)).toBe(by);
    expect((await handbookCatalogRepository.findActiveVersion())?.versionNo).toBe(1);
  });

  it("publish bản mới thì bản cũ chuyển sang archived — luôn đúng 1 bản active", async () => {
    await publishHandbookVersion({ versionNo: (await importDraft()).versionNo });
    const second = await importDraft();
    const result = await publishHandbookVersion({ versionNo: second.versionNo });

    expect(result).toEqual({ versionNo: 2, previousActiveVersionNo: 1, alreadyActive: false });
    const statuses = (await HandbookVersionModel.find({}).sort({ versionNo: 1 }).lean()).map(
      (v) => v.status
    );
    expect(statuses).toEqual(["archived", "active"]);
  });

  it("rollback: publish lại bản đã lưu trữ", async () => {
    await publishHandbookVersion({ versionNo: (await importDraft()).versionNo });
    await publishHandbookVersion({ versionNo: (await importDraft()).versionNo });

    const result = await publishHandbookVersion({ versionNo: 1 });

    expect(result).toEqual({ versionNo: 1, previousActiveVersionNo: 2, alreadyActive: false });
    const statuses = (await HandbookVersionModel.find({}).sort({ versionNo: 1 }).lean()).map(
      (v) => v.status
    );
    expect(statuses).toEqual(["active", "archived"]);
  });

  it("publish bản đang active là no-op", async () => {
    await publishHandbookVersion({ versionNo: (await importDraft()).versionNo });
    const before = await HandbookVersionModel.findOne({ versionNo: 1 }).lean();
    const result = await publishHandbookVersion({ versionNo: 1 });
    const after = await HandbookVersionModel.findOne({ versionNo: 1 }).lean();

    expect(result).toEqual({ versionNo: 1, previousActiveVersionNo: null, alreadyActive: true });
    expect(after?.publishedAt).toEqual(before?.publishedAt);
  });

  it("lỗi: không tìm thấy, versionNo sai, phiên bản không có Điều", async () => {
    await expect(publishHandbookVersion({ versionNo: 99 })).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(publishHandbookVersion({ versionNo: 0 })).rejects.toBeInstanceOf(
      ArgumentInvalidException
    );
    await expect(publishHandbookVersion({ versionNo: 1.5 })).rejects.toBeInstanceOf(
      ArgumentInvalidException
    );
    await HandbookVersionModel.create({ versionNo: 5, status: "draft" });
    await expect(publishHandbookVersion({ versionNo: 5 })).rejects.toThrow(/không có Điều nào/);
  });

  it("nguyên tử: kích hoạt bản mới lỗi thì bản cũ vẫn active", async () => {
    await publishHandbookVersion({ versionNo: (await importDraft()).versionNo });
    const second = await importDraft();

    jest.spyOn(handbookCatalogRepository, "activate").mockRejectedValueOnce(new Error("boom"));
    await expect(publishHandbookVersion({ versionNo: second.versionNo })).rejects.toThrow("boom");

    const statuses = (await HandbookVersionModel.find({}).sort({ versionNo: 1 }).lean()).map(
      (v) => v.status
    );
    expect(statuses).toEqual(["active", "draft"]);
  });

  it("hai lần publish đồng thời không bao giờ tạo ra 2 bản active", async () => {
    await publishHandbookVersion({ versionNo: (await importDraft()).versionNo });
    const second = await importDraft();
    const third = await importDraft();

    const settled = await Promise.allSettled([
      publishHandbookVersion({ versionNo: second.versionNo }),
      publishHandbookVersion({ versionNo: third.versionNo })
    ]);

    expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
    expect(await HandbookVersionModel.countDocuments({ status: "active" })).toBe(1);
  });
});
