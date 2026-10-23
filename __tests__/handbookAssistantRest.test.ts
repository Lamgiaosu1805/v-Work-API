import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import express from "express";
import moment from "moment-timezone";
import redisMock from "./mocks/redis";

jest.mock("../src/middlewares/authMiddleware", () => ({
  // Giữ các export thật (canManage, isAdmin...) để test nạp được toàn bộ src/routes/index.js
  ...jest.requireActual("../src/middlewares/authMiddleware"),
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-account"]) {
      return res.status(401).json({ message: "Chưa đăng nhập" });
    }
    req.account = { _id: req.headers["x-test-account"] };
    return next();
  }
}));
jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import handbookAssistantRouter from "../src/modules/handbook-assistant/interface/handbook-assistant.routes";
import { nextQuotaResetAt } from "../src/modules/handbook-assistant/application/quota.service";
import { importHandbookDraft, publishHandbookVersion } from "../src/modules/handbook-assistant";
import { errorHandlerMiddleware } from "../src/core/http/error-handler.middleware";
import { DateKey } from "../src/shared-kernel/date-key";
import AccountModel from "../src/models/AccountModel";
import UserInfoModel from "../src/models/UserInfoModel";
import HandbookVersionModel from "../src/models/HandbookVersionModel";
import HandbookArticleModel from "../src/models/HandbookArticleModel";
import HandbookConversationModel from "../src/models/HandbookConversationModel";
import HandbookMessageModel from "../src/models/HandbookMessageModel";
import HandbookUsageModel from "../src/models/HandbookUsageModel";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import sampleManifest from "../scripts/handbook/sample-handbook.manifest.json";
import { grantHandbookAssistantPermission } from "./helpers/grantHandbookAssistantPermission";
/* eslint-enable import/first */

type Employee = { accountId: string; employeeId: string };

let replset: MongoMemoryReplSet;
let app: express.Express;
let alice: Employee;
let bob: Employee;
let outsider: Employee; // không có quyền handbook_assistant.use

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let seq = 0;

async function createEmployee(withPermission: boolean): Promise<Employee> {
  seq += 1;
  const account = await AccountModel.create({
    username: `hbrest_${Date.now()}_${seq}`,
    password: "x",
    role: "user"
  });
  const info = await UserInfoModel.create({
    full_name: `NV ${seq}`,
    cccd: `${Date.now()}${seq}`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `HR${Date.now()}${seq}`,
    employment_type: "fulltime"
  });
  if (withPermission) await grantHandbookAssistantPermission(info._id);
  return { accountId: String(account._id), employeeId: String(info._id) };
}

const as = (who: Employee) => ({ "x-test-account": who.accountId });

async function publishSampleVersion(mutate?: (m: any) => void): Promise<number> {
  const manifest: any = clone(sampleManifest);
  mutate?.(manifest);
  const draft = await importHandbookDraft({ manifest });
  await publishHandbookVersion({ versionNo: draft.versionNo });
  return draft.versionNo;
}

async function createConversation(
  owner: Employee,
  overrides: { title?: string; lastMessageAt?: Date; version?: unknown } = {}
) {
  const version = overrides.version ?? (await HandbookVersionModel.findOne({}))?._id;
  return HandbookConversationModel.create({
    account: owner.accountId,
    title: overrides.title ?? "Nghỉ phép năm được mấy ngày?",
    version,
    turnCount: 1,
    lastMessageAt: overrides.lastMessageAt ?? new Date()
  });
}

async function createMessage(
  owner: Employee,
  conversationId: unknown,
  data: Record<string, unknown>
) {
  return HandbookMessageModel.create({
    conversation: conversationId,
    account: owner.accountId,
    status: "done",
    ...data
  });
}

// Một lượt hỏi–đáp hoàn chỉnh (user seq n, assistant seq n+1).
async function createTurn(
  owner: Employee,
  conversationId: unknown,
  n: number,
  assistant: Record<string, unknown> = {}
) {
  const user = await createMessage(owner, conversationId, {
    seq: n,
    role: "user",
    content: `Câu hỏi ${n}`
  });
  const answer = await createMessage(owner, conversationId, {
    seq: n + 1,
    role: "assistant",
    content: `Câu trả lời ${n}`,
    ...assistant
  });
  return { user, answer };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const models: mongoose.Model<any>[] = [
  HandbookVersionModel,
  HandbookArticleModel,
  HandbookConversationModel,
  HandbookMessageModel,
  HandbookUsageModel
];

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  await Promise.all(models.map((model) => model.init()));

  app = express();
  app.use(express.json());
  app.use("/handbook-assistant", handbookAssistantRouter);
  app.use(errorHandlerMiddleware);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  redisMock.__store.clear();
  delete process.env.HANDBOOK_DAILY_QUOTA;
  await Promise.all([
    ...models.map((model) => model.deleteMany({})),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({})
  ]);
  alice = await createEmployee(true);
  bob = await createEmployee(true);
  outsider = await createEmployee(false);
});

describe("xác thực & phân quyền", () => {
  const routes: Array<[string, string, string]> = [
    ["get", "/handbook-assistant/conversations", "danh sách hội thoại"],
    ["get", "/handbook-assistant/conversations/64b000000000000000000001/messages", "tin nhắn"],
    ["delete", "/handbook-assistant/conversations/64b000000000000000000001", "xoá hội thoại"],
    ["post", "/handbook-assistant/messages/64b000000000000000000001/feedback", "đánh giá"],
    ["get", "/handbook-assistant/articles/NOI_QUY/7", "điều khoản"],
    ["get", "/handbook-assistant/quota", "hạn mức"],
    ["get", "/handbook-assistant/suggestions", "gợi ý"]
  ];

  it.each(routes)("%s %s (%s): 401 khi chưa đăng nhập", async (method, url) => {
    const res = await (request(app) as any)[method](url);
    expect(res.status).toBe(401);
  });

  it.each(routes)(
    "%s %s (%s): 403 khi không có quyền handbook_assistant.use",
    async (method, url) => {
      const res = await (request(app) as any)[method](url).set(as(outsider)).send({ value: 1 });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Bạn không có quyền thực hiện thao tác này");
    }
  );
});

describe("GET /conversations", () => {
  it("chỉ trả hội thoại của mình, mới nhất trước, đúng hình dạng {_id, title, updatedAt}", async () => {
    await publishSampleVersion();
    const older = await createConversation(alice, {
      title: "Cũ",
      lastMessageAt: new Date("2026-10-20T03:00:00Z")
    });
    const newer = await createConversation(alice, {
      title: "Mới",
      lastMessageAt: new Date("2026-10-22T03:00:00Z")
    });
    await createConversation(bob, { title: "Của Bob" });

    const res = await request(app).get("/handbook-assistant/conversations").set(as(alice));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("OK");
    expect(res.body.data).toEqual([
      { _id: String(newer._id), title: "Mới", updatedAt: "2026-10-22T03:00:00.000Z" },
      { _id: String(older._id), title: "Cũ", updatedAt: "2026-10-20T03:00:00.000Z" }
    ]);
  });

  it("chưa có hội thoại nào → mảng rỗng", async () => {
    const res = await request(app).get("/handbook-assistant/conversations").set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("giới hạn 100 hội thoại mới nhất", async () => {
    await publishSampleVersion();
    const version = (await HandbookVersionModel.findOne({}))?._id;
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    await HandbookConversationModel.insertMany(
      Array.from({ length: 105 }, (_, i) => ({
        account: alice.accountId,
        title: `Hội thoại ${i}`,
        version,
        turnCount: 1,
        lastMessageAt: new Date(base + i * 60_000)
      }))
    );

    const res = await request(app).get("/handbook-assistant/conversations").set(as(alice));

    expect(res.body.data).toHaveLength(100);
    expect(res.body.data[0].title).toBe("Hội thoại 104");
    expect(res.body.data[99].title).toBe("Hội thoại 5");
  });
});

describe("GET /conversations/:id/messages", () => {
  it("trả tin theo thứ tự tăng dần với đủ trường, ẩn tin đang streaming", async () => {
    await publishSampleVersion();
    const conversation = await createConversation(alice);
    const citation = {
      documentCode: "NOI_QUY@1",
      documentTitle: "Nội quy lao động (mẫu)",
      label: "Nội quy – Điều 12",
      articleIdx: 12,
      citedText:
        "1. Người lao động làm việc đủ 12 tháng được nghỉ phép năm 12 ngày làm việc, hưởng nguyên lương."
    };
    // Cố ý chèn thứ tự ngược để chứng minh sắp xếp theo seq chứ không theo thứ tự tạo
    await createMessage(alice, conversation._id, {
      seq: 2,
      role: "assistant",
      content: "Bạn được nghỉ 12 ngày.",
      citations: [citation],
      truncated: true,
      feedback: -1
    });
    await createMessage(alice, conversation._id, { seq: 1, role: "user", content: "Nghỉ phép?" });
    await createMessage(alice, conversation._id, { seq: 3, role: "user", content: "Còn đi muộn?" });
    await createMessage(alice, conversation._id, {
      seq: 4,
      role: "assistant",
      content: "đang gõ…",
      status: "streaming"
    });

    const res = await request(app)
      .get(`/handbook-assistant/conversations/${conversation._id}/messages`)
      .set(as(alice));

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: any) => [m.role, m.content])).toEqual([
      ["user", "Nghỉ phép?"],
      ["assistant", "Bạn được nghỉ 12 ngày."],
      ["user", "Còn đi muộn?"]
    ]);
    const assistant = res.body.data[1];
    expect(Object.keys(assistant).sort()).toEqual(
      [
        "_id",
        "citations",
        "content",
        "createdAt",
        "errorCode",
        "feedback",
        "role",
        "status",
        "truncated"
      ].sort()
    );
    expect(assistant).toMatchObject({
      status: "done",
      errorCode: null,
      truncated: true,
      feedback: -1,
      citations: [citation]
    });
    expect(new Date(assistant.createdAt).toISOString()).toBe(assistant.createdAt);
    // tin user: chưa đánh giá, không citations
    expect(res.body.data[0]).toMatchObject({ feedback: null, citations: [], truncated: false });
  });

  it("trả lỗi/hủy kèm errorCode để web hiển thị đúng trạng thái", async () => {
    await publishSampleVersion();
    const conversation = await createConversation(alice);
    await createTurn(alice, conversation._id, 1, { status: "error", errorCode: "AI_UNAVAILABLE" });
    await createTurn(alice, conversation._id, 3, { status: "cancelled", errorCode: "CANCELLED" });

    const res = await request(app)
      .get(`/handbook-assistant/conversations/${conversation._id}/messages`)
      .set(as(alice));

    const answers = res.body.data.filter((m: any) => m.role === "assistant");
    expect(answers.map((m: any) => [m.status, m.errorCode])).toEqual([
      ["error", "AI_UNAVAILABLE"],
      ["cancelled", "CANCELLED"]
    ]);
  });

  it("404 với hội thoại của người khác, hội thoại không tồn tại; 400 với id sai định dạng", async () => {
    await publishSampleVersion();
    const bobs = await createConversation(bob);
    await createTurn(bob, bobs._id, 1);

    const forbidden = await request(app)
      .get(`/handbook-assistant/conversations/${bobs._id}/messages`)
      .set(as(alice));
    expect(forbidden.status).toBe(404);
    expect(JSON.stringify(forbidden.body)).not.toContain("Câu hỏi 1");

    const missing = await request(app)
      .get("/handbook-assistant/conversations/64b000000000000000000099/messages")
      .set(as(alice));
    expect(missing.status).toBe(404);

    const malformed = await request(app)
      .get("/handbook-assistant/conversations/khong-phai-id/messages")
      .set(as(alice));
    expect(malformed.status).toBe(400);
    expect(malformed.body.errorCode).toBe("INVALID_ID");
  });
});

describe("DELETE /conversations/:id", () => {
  it("xoá hẳn hội thoại + toàn bộ tin; không đụng hội thoại khác và số liệu dùng theo ngày", async () => {
    await publishSampleVersion();
    const target = await createConversation(alice);
    const other = await createConversation(alice, { title: "Giữ lại" });
    await createTurn(alice, target._id, 1);
    await createTurn(alice, target._id, 3, { feedback: 1 });
    await createTurn(alice, other._id, 1);
    await HandbookUsageModel.create({
      account: alice.accountId,
      dateKey: DateKey.from(new Date()).toString(),
      used: 3
    });

    const res = await request(app)
      .delete(`/handbook-assistant/conversations/${target._id}`)
      .set(as(alice));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Đã xoá hội thoại", data: null });
    expect(await HandbookConversationModel.findById(target._id)).toBeNull();
    expect(await HandbookMessageModel.countDocuments({ conversation: target._id })).toBe(0);
    expect(await HandbookConversationModel.findById(other._id)).not.toBeNull();
    expect(await HandbookMessageModel.countDocuments({ conversation: other._id })).toBe(2);
    expect((await HandbookUsageModel.findOne({ account: alice.accountId }))?.used).toBe(3);

    const list = await request(app).get("/handbook-assistant/conversations").set(as(alice));
    expect(list.body.data.map((c: any) => c.title)).toEqual(["Giữ lại"]);
  });

  it("404 và không xoá gì khi hội thoại của người khác / không tồn tại; 400 khi id sai", async () => {
    await publishSampleVersion();
    const bobs = await createConversation(bob);
    await createTurn(bob, bobs._id, 1);

    const forbidden = await request(app)
      .delete(`/handbook-assistant/conversations/${bobs._id}`)
      .set(as(alice));
    expect(forbidden.status).toBe(404);
    expect(await HandbookConversationModel.findById(bobs._id)).not.toBeNull();
    expect(await HandbookMessageModel.countDocuments({ conversation: bobs._id })).toBe(2);

    expect(
      (
        await request(app)
          .delete("/handbook-assistant/conversations/64b000000000000000000099")
          .set(as(alice))
      ).status
    ).toBe(404);
    expect(
      (await request(app).delete("/handbook-assistant/conversations/abc").set(as(alice))).status
    ).toBe(400);
  });

  it("rollback khi lỗi giữa chừng: không để mất tin mà vẫn còn hội thoại", async () => {
    await publishSampleVersion();
    const conversation = await createConversation(alice);
    await createTurn(alice, conversation._id, 1);
    const spy = jest
      .spyOn(HandbookConversationModel, "deleteOne")
      .mockRejectedValueOnce(new Error("boom"));

    const res = await request(app)
      .delete(`/handbook-assistant/conversations/${conversation._id}`)
      .set(as(alice));

    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await HandbookConversationModel.findById(conversation._id)).not.toBeNull();
    expect(await HandbookMessageModel.countDocuments({ conversation: conversation._id })).toBe(2);
  });
});

describe("POST /messages/:id/feedback", () => {
  const post = (who: Employee, id: unknown, body: unknown) =>
    request(app)
      .post(`/handbook-assistant/messages/${id}/feedback`)
      .set(as(who))
      .send(body as object);

  const stored = async (id: unknown) => {
    const doc = await HandbookMessageModel.findById(id).lean();
    return { value: doc?.feedback ?? null, comment: doc?.feedbackComment ?? null };
  };

  let messageId: string;
  beforeEach(async () => {
    await publishSampleVersion();
    const conversation = await createConversation(alice);
    const { answer } = await createTurn(alice, conversation._id, 1);
    messageId = String(answer._id);
  });

  it("ghi đánh giá và trả {messageId, value}; lịch sử phản ánh đúng", async () => {
    const res = await post(alice, messageId, { value: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "OK", data: { messageId, value: 1 } });
    expect(await stored(messageId)).toEqual({ value: 1, comment: null });

    const conversation = await HandbookConversationModel.findOne({ account: alice.accountId });
    const history = await request(app)
      .get(`/handbook-assistant/conversations/${conversation?._id}/messages`)
      .set(as(alice));
    expect(history.body.data.find((m: any) => m._id === messageId).feedback).toBe(1);
  });

  it("upsert: 👎 rồi 👎 kèm góp ý → giữ 1 đánh giá, có góp ý (đúng luồng của web)", async () => {
    await post(alice, messageId, { value: -1 });
    const second = await post(alice, messageId, { value: -1, comment: "  Thiếu số ngày cụ thể  " });

    expect(second.status).toBe(200);
    expect(await stored(messageId)).toEqual({ value: -1, comment: "Thiếu số ngày cụ thể" });
    expect(await HandbookMessageModel.countDocuments({ role: "assistant" })).toBe(1);
  });

  it("gửi lại cùng chiều không kèm góp ý thì GIỮ góp ý; đổi chiều không kèm góp ý thì XOÁ góp ý", async () => {
    await post(alice, messageId, { value: -1, comment: "Chưa rõ" });

    await post(alice, messageId, { value: -1 });
    expect(await stored(messageId)).toEqual({ value: -1, comment: "Chưa rõ" });

    await post(alice, messageId, { value: -1, comment: "   " });
    expect(await stored(messageId)).toEqual({ value: -1, comment: "Chưa rõ" });

    await post(alice, messageId, { value: 1 });
    expect(await stored(messageId)).toEqual({ value: 1, comment: null });
  });

  it("hai yêu cầu gần như đồng thời không ghi đè mất góp ý", async () => {
    await Promise.all([
      post(alice, messageId, { value: -1 }),
      post(alice, messageId, { value: -1, comment: "Góp ý đến sau" })
    ]);
    // dù thứ tự thực thi thế nào, góp ý không được mất
    await post(alice, messageId, { value: -1 });
    expect((await stored(messageId)).comment).toBe("Góp ý đến sau");
  });

  it("400 khi value sai hoặc góp ý sai; không thay đổi dữ liệu", async () => {
    for (const body of [{}, { value: 0 }, { value: 2 }, { value: "1" }, { value: null }]) {
      expect((await post(alice, messageId, body)).status).toBe(400);
    }
    expect((await post(alice, messageId, { value: 1, comment: 123 })).status).toBe(400);
    expect((await post(alice, messageId, { value: 1, comment: "x".repeat(1001) })).status).toBe(
      400
    );
    expect((await post(alice, messageId, { value: 1, comment: "x".repeat(1000) })).status).toBe(
      200
    );
    expect(await stored(messageId)).toEqual({ value: 1, comment: "x".repeat(1000) });
  });

  it("404 với tin của người khác / không tồn tại; 400 id sai; 400 với tin của user; 409 khi đang streaming", async () => {
    expect((await post(bob, messageId, { value: 1 })).status).toBe(404);
    expect(await stored(messageId)).toEqual({ value: null, comment: null });
    expect((await post(alice, "64b000000000000000000099", { value: 1 })).status).toBe(404);
    expect((await post(alice, "abc", { value: 1 })).status).toBe(400);

    const conversation = await HandbookConversationModel.findOne({ account: alice.accountId });
    const userMessage = await HandbookMessageModel.findOne({
      conversation: conversation?._id,
      role: "user"
    });
    const onUser = await post(alice, userMessage?._id, { value: 1 });
    expect(onUser.status).toBe(400);

    const streaming = await createMessage(alice, conversation?._id, {
      seq: 3,
      role: "assistant",
      content: "",
      status: "streaming"
    });
    const onStreaming = await post(alice, streaming._id, { value: 1 });
    expect(onStreaming.status).toBe(409);
    expect((await HandbookMessageModel.findById(streaming._id))?.feedback).toBeNull();
  });

  it("cho phép đánh giá cả câu trả lời bị lỗi/hủy", async () => {
    const conversation = await createConversation(alice);
    const { answer } = await createTurn(alice, conversation._id, 1, {
      status: "error",
      errorCode: "AI_UNAVAILABLE"
    });
    expect((await post(alice, answer._id, { value: -1 })).status).toBe(200);
  });
});

describe("GET /articles/:documentCode/:idx", () => {
  it("bản đang hiệu lực: đúng hình dạng, nội dung nguyên văn nối bằng xuống dòng", async () => {
    await publishSampleVersion();

    const res = await request(app).get("/handbook-assistant/articles/NOI_QUY/7").set(as(alice));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      documentCode: "NOI_QUY",
      documentTitle: "Nội quy lao động (mẫu)",
      articleIdx: 7,
      label: "Nội quy – Điều 7",
      title: "Điều 7. Thời giờ làm việc",
      content: [
        "1. Thời giờ làm việc từ Thứ Hai đến Thứ Sáu:",
        "a) Buổi sáng: từ 08h00 đến 12h00;",
        "b) Buổi chiều: từ 13h30 đến 17h30.",
        "2. Thứ Bảy làm việc buổi sáng từ 08h00 đến 12h00 theo lịch luân phiên do Trưởng phòng sắp xếp.",
        "3. Người lao động có nhu cầu làm việc linh hoạt phải được Trưởng phòng và Phòng Hành chính - Nhân sự chấp thuận bằng văn bản."
      ].join("\n")
    });
    const penalty = await request(app)
      .get("/handbook-assistant/articles/BAC_PHAT/1")
      .set(as(alice));
    expect(penalty.body.data.label).toBe("Bậc phạt – Đi muộn");
  });

  it("NOI_QUY@N trả đúng nội dung của phiên bản N dù đã có bản mới hơn", async () => {
    const v1 = await publishSampleVersion();
    const v2 = await publishSampleVersion((m) => {
      m.documents[0].articles[0].blocks = ["1. Giờ làm việc mới: 09h00 – 18h00."];
    });
    expect([v1, v2]).toEqual([1, 2]);

    const oldRes = await request(app)
      .get("/handbook-assistant/articles/NOI_QUY@1/7")
      .set(as(alice));
    const newRes = await request(app)
      .get("/handbook-assistant/articles/NOI_QUY@2/7")
      .set(as(alice));
    const plain = await request(app).get("/handbook-assistant/articles/NOI_QUY/7").set(as(alice));

    // web gọi encodeURIComponent("NOI_QUY@1") → "NOI_QUY%401"
    const encoded = await request(app)
      .get("/handbook-assistant/articles/NOI_QUY%401/7")
      .set(as(alice));
    expect(encoded.status).toBe(200);
    expect(encoded.body.data.documentCode).toBe("NOI_QUY@1");
    expect(encoded.body.data.content).toBe(oldRes.body.data.content);

    expect(oldRes.body.data.content).toContain("08h00 đến 12h00");
    expect(oldRes.body.data.documentCode).toBe("NOI_QUY@1");
    expect(newRes.body.data.content).toBe("1. Giờ làm việc mới: 09h00 – 18h00.");
    expect(plain.body.data.content).toBe("1. Giờ làm việc mới: 09h00 – 18h00.");
  });

  it("không chỉ định phiên bản: Điều đã bị bỏ khỏi bản mới vẫn mở được từ bản cũ gần nhất", async () => {
    await publishSampleVersion();
    await publishSampleVersion((m) => {
      m.documents[0].articles = m.documents[0].articles.filter((a: any) => a.articleIdx !== 13);
    });

    const res = await request(app).get("/handbook-assistant/articles/NOI_QUY/13").set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Điều 13. Nghỉ việc riêng có hưởng lương");

    const pinned = await request(app)
      .get("/handbook-assistant/articles/NOI_QUY@2/13")
      .set(as(alice));
    expect(pinned.status).toBe(404);
  });

  it("bản nháp chưa publish không bao giờ lộ ra", async () => {
    await publishSampleVersion();
    const manifest: any = clone(sampleManifest);
    manifest.documents[0].articles[0].blocks = ["BẢN NHÁP BÍ MẬT"];
    const draft = await importHandbookDraft({ manifest });

    const pinned = await request(app)
      .get(`/handbook-assistant/articles/NOI_QUY@${draft.versionNo}/7`)
      .set(as(alice));
    expect(pinned.status).toBe(404);
    const plain = await request(app).get("/handbook-assistant/articles/NOI_QUY/7").set(as(alice));
    expect(plain.body.data.content).not.toContain("BÍ MẬT");
  });

  it("404 khi không có Điều / văn bản / phiên bản; 404 khi chưa có bản nào được publish", async () => {
    const none = await request(app).get("/handbook-assistant/articles/NOI_QUY/7").set(as(alice));
    expect(none.status).toBe(404);

    await publishSampleVersion();
    for (const url of [
      "/handbook-assistant/articles/NOI_QUY/999",
      "/handbook-assistant/articles/KHONG_CO/1",
      "/handbook-assistant/articles/NOI_QUY@9/7"
    ]) {
      expect((await request(app).get(url).set(as(alice))).status).toBe(404);
    }
  });

  it("400 khi documentCode hoặc idx sai định dạng", async () => {
    await publishSampleVersion();
    for (const url of [
      "/handbook-assistant/articles/noi_quy/7",
      "/handbook-assistant/articles/NOI_QUY@/7",
      "/handbook-assistant/articles/NOI_QUY@x/7",
      "/handbook-assistant/articles/NOI_QUY/abc",
      "/handbook-assistant/articles/NOI_QUY/-1",
      "/handbook-assistant/articles/NOI_QUY/1.5",
      "/handbook-assistant/articles/NOI_QUY/12345"
    ]) {
      const res = await request(app).get(url).set(as(alice));
      expect([url, res.status]).toEqual([url, 400]);
    }
  });
});

describe("GET /quota", () => {
  const todayKey = () => DateKey.from(new Date()).toString();

  it("chưa hỏi lần nào hôm nay: used 0, remaining = limit (mặc định 30)", async () => {
    const res = await request(app).get("/handbook-assistant/quota").set(as(alice));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ limit: 30, used: 0, remaining: 30 });
    const resetAt = new Date(res.body.data.resetAt);
    expect(resetAt.toISOString()).toBe(res.body.data.resetAt);
    expect(resetAt.getTime()).toBeGreaterThan(Date.now());
    expect(resetAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000);
    expect(moment.tz(resetAt, "Asia/Ho_Chi_Minh").format("HH:mm:ss")).toBe("00:00:00");
  });

  it("đếm đúng lượt đã dùng hôm nay của chính mình; không tính hôm qua, không tính người khác", async () => {
    const yesterday = DateKey.from(new Date(Date.now() - 24 * 3600 * 1000)).toString();
    await HandbookUsageModel.create({ account: alice.accountId, dateKey: todayKey(), used: 5 });
    await HandbookUsageModel.create({ account: alice.accountId, dateKey: yesterday, used: 20 });
    await HandbookUsageModel.create({ account: bob.accountId, dateKey: todayKey(), used: 9 });

    const a = await request(app).get("/handbook-assistant/quota").set(as(alice));
    const b = await request(app).get("/handbook-assistant/quota").set(as(bob));

    expect(a.body.data).toMatchObject({ limit: 30, used: 5, remaining: 25 });
    expect(b.body.data).toMatchObject({ limit: 30, used: 9, remaining: 21 });
  });

  it("remaining không âm khi đã vượt hạn mức; hạn mức đổi được bằng HANDBOOK_DAILY_QUOTA", async () => {
    process.env.HANDBOOK_DAILY_QUOTA = "3";
    await HandbookUsageModel.create({ account: alice.accountId, dateKey: todayKey(), used: 5 });

    const res = await request(app).get("/handbook-assistant/quota").set(as(alice));
    expect(res.body.data).toMatchObject({ limit: 3, used: 5, remaining: 0 });

    process.env.HANDBOOK_DAILY_QUOTA = "không phải số";
    const fallback = await request(app).get("/handbook-assistant/quota").set(as(alice));
    expect(fallback.body.data.limit).toBe(30);
  });
});

describe("nextQuotaResetAt", () => {
  it("luôn là 00:00 ngày kế tiếp theo giờ Việt Nam, không phụ thuộc múi giờ máy", () => {
    // 23:59:59 giờ VN ngày 23/10 → 00:00 ngày 24/10 (= 17:00Z ngày 23/10)
    expect(nextQuotaResetAt(new Date("2026-10-23T16:59:59Z")).toISOString()).toBe(
      "2026-10-23T17:00:00.000Z"
    );
    // đúng 00:00:00 giờ VN → 24 giờ sau
    expect(nextQuotaResetAt(new Date("2026-10-23T17:00:00Z")).toISOString()).toBe(
      "2026-10-24T17:00:00.000Z"
    );
    // 00:00Z (07:00 giờ VN) → vẫn là nửa đêm giờ VN kế tiếp
    expect(nextQuotaResetAt(new Date("2026-10-23T00:00:00Z")).toISOString()).toBe(
      "2026-10-23T17:00:00.000Z"
    );
  });
});

describe("GET /suggestions", () => {
  it("lấy từ phiên bản đang hiệu lực", async () => {
    await publishSampleVersion();
    const res = await request(app).get("/handbook-assistant/suggestions").set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      "Nghỉ phép năm được mấy ngày?",
      "Đi muộn bị xử lý thế nào?",
      "Quên chấm công phải làm gì?"
    ]);
  });

  it("chưa có bản nào hiệu lực (kể cả đã có bản nháp) → mảng rỗng", async () => {
    expect(
      (await request(app).get("/handbook-assistant/suggestions").set(as(alice))).body.data
    ).toEqual([]);
    await importHandbookDraft({ manifest: clone(sampleManifest) });
    expect(
      (await request(app).get("/handbook-assistant/suggestions").set(as(alice))).body.data
    ).toEqual([]);
  });

  it("đổi theo phiên bản mới publish", async () => {
    await publishSampleVersion();
    await publishSampleVersion((m) => {
      m.suggestions = ["Câu gợi ý mới?"];
    });
    const res = await request(app).get("/handbook-assistant/suggestions").set(as(alice));
    expect(res.body.data).toEqual(["Câu gợi ý mới?"]);
  });
});

describe("gắn vào ứng dụng thật (src/routes/index.js)", () => {
  // Không nạp cả cây routes (cần nhiều biến môi trường upload và tạo thư mục trên đĩa) nên kiểm tra
  // tĩnh: router được require đúng đường dẫn và mount đúng prefix mà web gọi.
  const source = fs.readFileSync(path.join(__dirname, "../src/routes/index.js"), "utf8");

  it("mount /handbook-assistant bằng router của module", () => {
    const requirePath = /const handbookAssistantRouter = require\("([^"]+)"\);/.exec(source)?.[1];
    expect(requirePath).toBe("../modules/handbook-assistant/interface/handbook-assistant.routes");
    expect(() =>
      require.resolve(path.join(__dirname, "../src/routes", requirePath as string))
    ).not.toThrow();
    expect(source).toContain('app.use("/handbook-assistant", handbookAssistantRouter);');
  });
});
