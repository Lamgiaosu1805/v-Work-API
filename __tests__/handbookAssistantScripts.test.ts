import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { cleanExtractedPages, parseManifest } from "../src/modules/handbook-assistant";
import { readPdfPages } from "../scripts/handbook/lib/pdf-reader";
import HandbookVersionModel from "../src/models/HandbookVersionModel";
import HandbookArticleModel from "../src/models/HandbookArticleModel";

const ROOT = path.resolve(__dirname, "..");
const SAMPLE_MANIFEST = path.join(ROOT, "scripts/handbook/sample-handbook.manifest.json");

type ScriptResult = { code: number | null; out: string };

// Chạy script bằng `spawn` BẤT ĐỒNG BỘ (không dùng spawnSync): mongod tạm ghi log vào pipe của tiến
// trình test, nếu event loop bị chặn thì pipe đầy → mongod đứng → script chờ mongod → deadlock.
function runScript(
  script: string,
  args: string[] = [],
  env: Record<string, string> = {}
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "-r",
        "ts-node/register/transpile-only",
        path.join(ROOT, "scripts/handbook", script),
        ...args
      ],
      { cwd: ROOT, env: { ...process.env, NODE_ENV: "test", ...env } }
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

// Báo kèm toàn bộ output của script khi chạy thất bại để dễ tìm nguyên nhân.
function expectSuccess(result: { code: number | null; out: string }): void {
  if (result.code !== 0) throw new Error(`Script thoát với mã ${result.code}:\n${result.out}`);
}

// PDF tối thiểu hợp lệ (font Helvetica chuẩn, chỉ ASCII) — đủ để kiểm tra bước đọc từng trang.
function buildPdf(pages: string[][]): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  pages.forEach((lines, i) => {
    const stream = `BT /F1 12 Tf 14 TL 50 750 Td ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

describe("readPdfPages", () => {
  it("đọc đúng từng trang, từng dòng; sha256 khớp file", async () => {
    const pages = [
      ["HEADER CONG TY", "Page one line A", "Page one line B", "Footer 1"],
      ["HEADER CONG TY", "Page two line A", "Footer 2"],
      ["HEADER CONG TY", "Page three line A", "Footer 3"]
    ];
    const buffer = buildPdf(pages);

    const result = await readPdfPages(buffer);

    expect(result.pages).toHaveLength(3);
    expect(result.pages[0].split("\n").map((l) => l.trim())).toEqual(pages[0]);
    expect(result.pages[2].split("\n").map((l) => l.trim())).toEqual(pages[2]);
    expect(result.sha256).toBe(crypto.createHash("sha256").update(buffer).digest("hex"));
  });

  it("kết hợp với bộ làm sạch: bỏ header lặp, giữ nội dung", async () => {
    const buffer = buildPdf(
      [1, 2, 3, 4].map((n) => ["HEADER CONG TY", `Noi dung doan ${n}`, `Page ${n}`])
    );
    const { pages } = await readPdfPages(buffer);
    expect(cleanExtractedPages(pages).split("\n")).toEqual([
      "Noi dung doan 1",
      "Noi dung doan 2",
      "Noi dung doan 3",
      "Noi dung doan 4"
    ]);
  });

  it("đọc đúng cả khi Buffer nhỏ nằm lệch trong pool dùng chung (byteOffset khác 0)", async () => {
    const pdf = buildPdf([["Offset test line one here", "Offset test line two here"]]);
    // Đặt PDF vào giữa một ArrayBuffer lớn hơn, đúng như Buffer.from(string) lấy từ pool của Node.
    const shared = new ArrayBuffer(pdf.length + 37);
    new Uint8Array(shared).set(pdf, 13);
    const view = Buffer.from(shared, 13, pdf.length);
    expect(view.byteOffset).toBe(13);

    const result = await readPdfPages(view);
    expect(result.pages[0].split("\n").map((l) => l.trim())).toEqual([
      "Offset test line one here",
      "Offset test line two here"
    ]);
  });

  it("PDF không có lớp chữ (scan) → báo lỗi rõ ràng", async () => {
    await expect(readPdfPages(buildPdf([[], []]))).rejects.toThrow(/không có lớp chữ/);
  });

  it("file không phải PDF → lỗi", async () => {
    await expect(readPdfPages(Buffer.from("không phải pdf"))).rejects.toThrow();
  });
});

describe("scripts/handbook CLI", () => {
  jest.setTimeout(120000);
  let tmp: string;

  const run = (script: string, args: string[]) => runScript(script, args);

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handbook-cli-"));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const NOI_QUY_TXT = [
    "Chương I",
    "QUY ĐỊNH CHUNG",
    "Điều 1. Phạm vi áp dụng",
    "1. Nội quy này áp dụng cho mọi người lao động.",
    "Điều 2. Chấm công",
    "1. Chấm công trên vWork khi bắt đầu và kết thúc ngày làm việc.",
    "2. Quên chấm công thì tạo đơn giải trình."
  ].join("\n");

  it("extract: txt → manifest + preview; chạy lại cùng --out thì gộp, cùng --code thì thay thế", async () => {
    const input = path.join(tmp, "noi-quy.txt");
    const out = path.join(tmp, "handbook.manifest.json");
    fs.writeFileSync(input, NOI_QUY_TXT);

    const first = await run("extract-handbook.ts", [
      `--input=${input}`,
      "--code=NOI_QUY",
      "--title=Nội quy lao động",
      "--short=Nội quy",
      `--out=${out}`
    ]);
    expectSuccess(first);
    const manifest = parseManifest(JSON.parse(fs.readFileSync(out, "utf8")));
    expect(manifest.documents).toHaveLength(1);
    expect(manifest.documents[0]).toMatchObject({
      documentCode: "NOI_QUY",
      documentTitle: "Nội quy lao động",
      shortName: "Nội quy",
      sourceFileName: "noi-quy.txt"
    });
    expect(manifest.documents[0].sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.documents[0].articles.map((a) => a.label)).toEqual([
      "Nội quy – Điều 1",
      "Nội quy – Điều 2"
    ]);
    expect(manifest.documents[0].articles[1].blocks).toHaveLength(2);
    expect(manifest.documents[0].articles[0].chapter).toBe("Chương I. QUY ĐỊNH CHUNG");
    const preview = fs.readFileSync(path.join(tmp, "handbook.manifest.preview.md"), "utf8");
    expect(preview).toContain("Nội quy – Điều 2");

    // văn bản thứ hai được gộp vào cùng manifest
    const second = fs.writeFileSync(
      path.join(tmp, "bp.txt"),
      "Điều 1. Đi muộn\n- Lần 1: nhắc nhở."
    );
    expect(second).toBeUndefined();
    const merged = await run("extract-handbook.ts", [
      `--input=${path.join(tmp, "bp.txt")}`,
      "--code=BAC_PHAT",
      "--title=Bậc phạt",
      "--short=Bậc phạt",
      `--out=${out}`
    ]);
    expectSuccess(merged);
    expect(
      parseManifest(JSON.parse(fs.readFileSync(out, "utf8"))).documents.map((d) => d.documentCode)
    ).toEqual(["NOI_QUY", "BAC_PHAT"]);

    // chạy lại NOI_QUY: thay thế, không nhân đôi
    const again = await run("extract-handbook.ts", [
      `--input=${input}`,
      "--code=NOI_QUY",
      "--title=Nội quy lao động (bản 2)",
      "--short=Nội quy",
      `--out=${out}`
    ]);
    expectSuccess(again);
    const final = parseManifest(JSON.parse(fs.readFileSync(out, "utf8")));
    expect(final.documents.map((d) => d.documentCode)).toEqual(["BAC_PHAT", "NOI_QUY"]);
    expect(final.documents[1].documentTitle).toBe("Nội quy lao động (bản 2)");
  });

  it("extract: --keep-preamble giữ phần trước Điều đầu tiên làm mục 0", async () => {
    const input = path.join(tmp, "pre.txt");
    const out = path.join(tmp, "pre.manifest.json");
    fs.writeFileSync(input, `Căn cứ Bộ luật Lao động.\n${NOI_QUY_TXT}`);
    const result = await run("extract-handbook.ts", [
      `--input=${input}`,
      "--code=NOI_QUY",
      "--title=T",
      "--short=Nội quy",
      `--out=${out}`,
      "--keep-preamble"
    ]);
    expectSuccess(result);
    const [doc] = parseManifest(JSON.parse(fs.readFileSync(out, "utf8"))).documents;
    expect(doc.articles[0]).toMatchObject({ articleIdx: 0, title: "Phần mở đầu" });
    expect(doc.articles[0].blocks).toEqual(["Căn cứ Bộ luật Lao động."]);
  });

  it("extract: lỗi rõ ràng khi mã sai, không có Điều, PDF không có chữ Điều", async () => {
    const input = path.join(tmp, "no-article.txt");
    fs.writeFileSync(input, "Chỉ là đoạn văn, không có tiêu đề Điều nào.");
    const base = ["--title=T", "--short=S", `--out=${path.join(tmp, "x.json")}`];

    const badCode = await run("extract-handbook.ts", [
      `--input=${input}`,
      "--code=noi quy",
      ...base
    ]);
    expect(badCode.code).not.toBe(0);
    expect(badCode.out).toContain("--code chỉ gồm A-Z");

    const noArticle = await run("extract-handbook.ts", [
      `--input=${input}`,
      "--code=NOI_QUY",
      ...base
    ]);
    expect(noArticle.code).not.toBe(0);
    expect(noArticle.out).toContain("Không tách được Điều nào");
    expect(fs.existsSync(path.join(tmp, "x.json"))).toBe(false);

    const pdf = path.join(tmp, "ascii.pdf");
    fs.writeFileSync(
      pdf,
      buildPdf([["Hello world, this page has text but no Vietnamese headings"]])
    );
    const viaPdf = await run("extract-handbook.ts", [`--input=${pdf}`, "--code=NOI_QUY", ...base]);
    expect(viaPdf.code).not.toBe(0);
    expect(viaPdf.out).toContain("Không tách được Điều nào");

    const missingArg = await run("extract-handbook.ts", [`--input=${input}`]);
    expect(missingArg.code).not.toBe(0);
    expect(missingArg.out).toContain("Thiếu tham số --code");
  });

  it("import --dry-run: manifest mẫu hợp lệ; manifest sai bị từ chối mà không cần DB", async () => {
    const ok = await run("import-handbook.ts", [`--manifest=${SAMPLE_MANIFEST}`, "--dry-run"]);
    expectSuccess(ok);
    expect(ok.out).toContain("NOI_QUY: 5 mục");
    expect(ok.out).toContain("BAC_PHAT: 2 mục");
    expect(ok.out).toContain("Manifest hợp lệ");

    const bad = path.join(tmp, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ documents: [{ documentCode: "x" }] }));
    const rejected = await run("import-handbook.ts", [`--manifest=${bad}`, "--dry-run"]);
    expect(rejected.code).not.toBe(0);
    expect(rejected.out).toContain("Manifest không hợp lệ");
  });
});

describe("manifest mẫu", () => {
  it("hợp lệ và có đủ 2 văn bản với nhãn như mock của web", async () => {
    const manifest = parseManifest(JSON.parse(fs.readFileSync(SAMPLE_MANIFEST, "utf8")));
    expect(manifest.documents.map((d) => d.documentCode)).toEqual(["NOI_QUY", "BAC_PHAT"]);
    expect(manifest.documents[1].articles.map((a) => a.label)).toEqual([
      "Bậc phạt – Đi muộn",
      "Bậc phạt – Quên chấm công"
    ]);
    expect(manifest.suggestions).toHaveLength(3);
  });
});

describe("scripts/handbook với MongoDB", () => {
  jest.setTimeout(180000);
  let replset: MongoMemoryReplSet;
  let uri: string;
  let tmp: string;

  const run = (script: string, args: string[] = [], env: Record<string, string> = {}) =>
    runScript(script, args, { MONGODB_URI: uri, ...env });

  const statuses = async () =>
    (await HandbookVersionModel.find({}).sort({ versionNo: 1 }).lean()).map(
      (v) => `${v.versionNo}:${v.status}`
    );

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replset.getUri("handbook_cli");
    await mongoose.connect(uri);
    await Promise.all([HandbookVersionModel.init(), HandbookArticleModel.init()]);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handbook-cli-db-"));
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replset.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("seed-sample: nạp + publish bộ mẫu; chạy lại thì bỏ qua; --force tạo bản mới", async () => {
    const first = await run("seed-sample-handbook.ts");
    expectSuccess(first);
    expect(first.out).toContain("Đã nạp + publish bộ mẫu thành phiên bản 1 (7 mục)");
    expect(await statuses()).toEqual(["1:active"]);
    const v1 = await HandbookVersionModel.findOne({ versionNo: 1 }).lean();
    expect(await HandbookArticleModel.countDocuments({ version: v1?._id })).toBe(7);

    const again = await run("seed-sample-handbook.ts");
    expectSuccess(again);
    expect(again.out).toContain("Đã có bản hiệu lực số 1");
    expect(await statuses()).toEqual(["1:active"]);

    const forced = await run("seed-sample-handbook.ts", ["--force"]);
    expectSuccess(forced);
    expect(await statuses()).toEqual(["1:archived", "2:active"]);
  });

  it("seed-sample từ chối chạy ở production", async () => {
    const result = await run("seed-sample-handbook.ts", ["--force"], { NODE_ENV: "production" });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("production");
  });

  it("import → nháp (giữ văn bản không đổi); publish; publish lại; publish bản không tồn tại", async () => {
    const manifest = JSON.parse(fs.readFileSync(SAMPLE_MANIFEST, "utf8"));
    manifest.documents = [manifest.documents[0]];
    manifest.suggestions = [];
    const manifestPath = path.join(tmp, "update.manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const imported = await run("import-handbook.ts", [
      `--manifest=${manifestPath}`,
      "--note=Cập nhật thử"
    ]);
    expectSuccess(imported);
    expect(imported.out).toContain("Đã tạo bản NHÁP số 3 (7 mục)");
    expect(imported.out).toContain("BAC_PHAT: 2 mục (giữ nguyên từ bản cũ)");
    expect(await statuses()).toEqual(["1:archived", "2:active", "3:draft"]);
    expect((await HandbookVersionModel.findOne({ versionNo: 3 }).lean())?.note).toBe(
      "Cập nhật thử"
    );

    const published = await run("publish-handbook.ts", ["--version=3"]);
    expectSuccess(published);
    expect(published.out).toContain("Đã publish phiên bản 3 (bản 2 → lưu trữ)");
    expect(await statuses()).toEqual(["1:archived", "2:archived", "3:active"]);

    const repeat = await run("publish-handbook.ts", ["--version=3"]);
    expectSuccess(repeat);
    expect(repeat.out).toContain("đã là bản hiệu lực");

    const rollback = await run("publish-handbook.ts", ["--version=1"]);
    expectSuccess(rollback);
    expect(await statuses()).toEqual(["1:active", "2:archived", "3:archived"]);

    const missing = await run("publish-handbook.ts", ["--version=99"]);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain("Không tìm thấy phiên bản 99");
    expect(await statuses()).toEqual(["1:active", "2:archived", "3:archived"]);
  });

  it("import --drop bỏ văn bản; manifest sai không ghi gì", async () => {
    const manifest = JSON.parse(fs.readFileSync(SAMPLE_MANIFEST, "utf8"));
    manifest.documents = [manifest.documents[0]];
    const manifestPath = path.join(tmp, "drop.manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const dropped = await run("import-handbook.ts", [
      `--manifest=${manifestPath}`,
      "--drop=BAC_PHAT"
    ]);
    expectSuccess(dropped);
    expect(dropped.out).not.toContain("BAC_PHAT");
    const draft = await HandbookVersionModel.findOne({ versionNo: 4 }).lean();
    expect(draft?.documents.map((d) => d.documentCode)).toEqual(["NOI_QUY"]);

    const badPath = path.join(tmp, "bad.manifest.json");
    fs.writeFileSync(badPath, JSON.stringify({ documents: [] }));
    const before = await HandbookVersionModel.countDocuments({});
    const bad = await run("import-handbook.ts", [`--manifest=${badPath}`]);
    expect(bad.code).not.toBe(0);
    expect(bad.out).toContain("Manifest không hợp lệ");
    expect(await HandbookVersionModel.countDocuments({})).toBe(before);
  });
});
