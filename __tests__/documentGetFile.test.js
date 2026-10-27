const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const request = require("supertest");

// GET /document/getFile (production): chỉ trả file trong UPLOAD_DIR_PROD, chặn ../ và đường dẫn tuyệt đối, và
// KHÔNG trả file ticket (mặc định nằm ở UPLOAD_DIR_PROD/ticket) — file ticket chỉ tải qua /tickets có kiểm quyền.

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "getfile-"));
const UPLOAD_DIR = path.join(ROOT, "private");
const SIBLING_DIR = path.join(ROOT, "internal");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const ENV_KEYS = ["NODE_ENV", "UPLOAD_DIR_PROD", "TICKET_DIR_PROD"];
const savedEnv = {};

let app;

beforeAll(() => {
  ENV_KEYS.forEach((key) => {
    savedEnv[key] = process.env[key];
  });
  process.env.NODE_ENV = "production";
  process.env.UPLOAD_DIR_PROD = UPLOAD_DIR;
  delete process.env.TICKET_DIR_PROD;

  write(path.join(UPLOAD_DIR, "hop-dong.pdf"), "pdf");
  write(path.join(UPLOAD_DIR, "ticket-2024.pdf"), "pdf");
  write(path.join(UPLOAD_DIR, "feed", "anh-cu.png"), "png");
  write(path.join(UPLOAD_DIR, "ticket", "cccd.pdf"), "cccd");
  write(path.join(SIBLING_DIR, "bao-cao.pdf"), "internal");

  // Nạp sau khi đặt env (controller đọc env lúc chạy, nhưng giữ thứ tự cho chắc).
  // eslint-disable-next-line global-require
  const DocumentController = require("../src/controllers/DocumentController");
  app = express();
  app.get("/document/getFile", DocumentController.getFile);
});

afterAll(() => {
  ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
  fs.rmSync(ROOT, { recursive: true, force: true });
});

const getFile = (filename) => request(app).get("/document/getFile").query({ filename });

describe("GET /document/getFile", () => {
  it("trả file hợp lệ trong thư mục upload", async () => {
    const res = await getFile("hop-dong.pdf");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("vẫn trả file trong thư mục con và fallback feed/ cho bài viết cũ", async () => {
    expect((await getFile("feed/anh-cu.png")).status).toBe(200);
    expect((await getFile("anh-cu.png")).status).toBe(200);
  });

  it("giữ hành vi cũ với tên có / ở đầu", async () => {
    expect((await getFile("/hop-dong.pdf")).status).toBe(200);
    expect((await getFile("/feed/anh-cu.png")).status).toBe(200);
  });

  it("file thường có tên bắt đầu bằng 'ticket' không bị chặn nhầm", async () => {
    expect((await getFile("ticket-2024.pdf")).status).toBe(200);
  });

  it("không trả file ticket, kể cả viết vòng", async () => {
    for (const name of [
      "ticket/cccd.pdf",
      "feed/../ticket/cccd.pdf",
      "./ticket/cccd.pdf",
      "ticket"
    ]) {
      const res = await getFile(name);
      expect(res.status).toBe(404);
    }
  });

  it("chặn ../ ra ngoài thư mục upload", async () => {
    for (const name of [
      "../internal/bao-cao.pdf",
      "..%2Finternal%2Fbao-cao.pdf",
      "feed/../../internal/bao-cao.pdf",
      ".."
    ]) {
      const res = await getFile(name);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("internal");
    }
  });

  it("chặn đường dẫn tuyệt đối", async () => {
    const res = await getFile(path.join(SIBLING_DIR, "bao-cao.pdf"));
    expect(res.status).toBe(404);
  });

  it("filename dạng mảng trả 400", async () => {
    const res = await request(app).get("/document/getFile?filename=a&filename=b");
    expect(res.status).toBe(400);
  });
});
