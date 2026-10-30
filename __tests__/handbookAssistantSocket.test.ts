import http from "http";
import { AddressInfo } from "net";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { io as connectClient, Socket as ClientSocket } from "socket.io-client";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import redisMock from "./mocks/redis";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import { importHandbookDraft, publishHandbookVersion } from "../src/modules/handbook-assistant";
import {
  createSocketEventSink,
  setupHandbookAssistantSocket
} from "../src/modules/handbook-assistant/interface/handbook-assistant.socket";
import { runningAnswers } from "../src/modules/handbook-assistant/application/running-answers.registry";
import { clearPromptArticleCache } from "../src/modules/handbook-assistant/application/prompt-articles.service";
import { acquireBusyLock } from "../src/modules/handbook-assistant/infrastructure/busy-lock";
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
import {
  FakeAnswerer,
  controllable,
  createDeps,
  failWith,
  sleep,
  streamText,
  waitFor
} from "./helpers/handbookAssistantFakes";
/* eslint-enable import/first */

// chatSocket.js (JS) được nạp qua require để dùng đúng middleware xác thực thật (JWT + room account:<id>).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const setupChatSocket = require("../src/sockets/chatSocket");

interface Employee {
  accountId: string;
  employeeId: string;
  token: string;
}

type LogEntry = { event: string; payload: any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const models: mongoose.Model<any>[] = [
  HandbookVersionModel,
  HandbookArticleModel,
  HandbookConversationModel,
  HandbookMessageModel,
  HandbookUsageModel
];

let replset: MongoMemoryReplSet;
let httpServer: http.Server;
let server: Server;
let url: string;
let answerer: FakeAnswerer;
let alice: Employee;
let bob: Employee;
let outsider: Employee;
const clients: ClientSocket[] = [];
let seq = 0;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function createEmployee(withPermission: boolean): Promise<Employee> {
  seq += 1;
  const account = await AccountModel.create({
    username: `hbsock_${Date.now()}_${seq}`,
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
    ma_nv: `HS${Date.now()}${seq}`,
    employment_type: "fulltime"
  });
  if (withPermission) await grantHandbookAssistantPermission(info._id);
  return {
    accountId: String(account._id),
    employeeId: String(info._id),
    token: jwt.sign({ id: String(account._id) }, process.env.SECRET_KEY as string)
  };
}

// Kết nối một "tab" và ghi lại mọi sự kiện nhận được (đúng thứ tự đến).
async function connect(token?: string): Promise<{ socket: ClientSocket; log: LogEntry[] }> {
  const socket = connectClient(url, {
    transports: ["websocket"],
    auth: token ? { token } : {},
    reconnection: false,
    forceNew: true
  });
  clients.push(socket);
  const log: LogEntry[] = [];
  socket.onAny((event, payload) => log.push({ event, payload }));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  return { socket, log };
}

const askVia = (socket: ClientSocket, payload: unknown, log?: LogEntry[]) =>
  new Promise<any>((resolve) => {
    socket.emit("handbook:ask", payload, (ack: unknown) => {
      log?.push({ event: "ack", payload: ack });
      resolve(ack);
    });
  });

// Chờ một câu trả lời chốt xong HOÀN TOÀN: tin đã `done` và slot đã nhả (việc nhả slot nằm sau mọi ghi
// nhận phụ và ngay trước sự kiện kết thúc), để test tiếp theo không bị dữ liệu của test trước lọt vào.
const settledAnswer = (messageId: string) =>
  waitFor(
    async () =>
      (await HandbookMessageModel.findById(messageId))?.status === "done" &&
      runningAnswers.size === 0,
    3000,
    "câu trả lời chốt xong"
  );

const eventsOf = (log: LogEntry[], name: string) => log.filter((entry) => entry.event === name);
const names = (log: LogEntry[]) => log.map((entry) => entry.event);
const clientId = () => {
  seq += 1;
  return `sock-client-${seq}`;
};

beforeAll(async () => {
  process.env.SECRET_KEY = "test-secret-handbook";
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  await Promise.all(models.map((model) => model.init()));

  httpServer = http.createServer();
  server = new Server(httpServer, { transports: ["websocket"] });
  answerer = new FakeAnswerer();
  setupChatSocket(server); // middleware xác thực thật + room account:<id>
  setupHandbookAssistantSocket(
    server,
    createDeps(answerer, createSocketEventSink(server), { acquireBusyLock })
  );
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
}, 120000);

afterAll(async () => {
  clients.forEach((socket) => socket.disconnect());
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  redisMock.__store.clear();
  runningAnswers.clear();
  clearPromptArticleCache();
  clients.splice(0).forEach((socket) => socket.disconnect());
  Object.keys(process.env)
    .filter((key) => key.startsWith("HANDBOOK_"))
    .forEach((key) => delete process.env[key]);
  await Promise.all([
    ...models.map((model) => model.deleteMany({})),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({})
  ]);
  answerer.calls = [];
  answerer.configured = true;
  answerer.script = streamText(["Xin ", "chào"]);
  const draft = await importHandbookDraft({ manifest: clone(sampleManifest) as any });
  await publishHandbookVersion({ versionNo: draft.versionNo });
  alice = await createEmployee(true);
  bob = await createEmployee(true);
  outsider = await createEmployee(false);
});

describe("luồng hỏi qua socket thật", () => {
  it("ack → handbook:start → delta → done, đúng hình dạng hợp đồng với web và đúng thứ tự", async () => {
    const { socket, log } = await connect(alice.token);
    answerer.script = streamText(["Theo Điều 12, ", "bạn được nghỉ 12 ngày."], {
      citations: [{ documentIndex: 3, startBlock: 0, endBlock: 1, citedText: "x" }]
    });
    const id = clientId();

    const ack = await askVia(
      socket,
      { conversationId: null, question: "Nghỉ phép?", clientId: id },
      log
    );
    await waitFor(() => eventsOf(log, "handbook:done")[0], 3000, "handbook:done");

    expect(ack).toEqual({
      ok: true,
      conversationId: expect.stringMatching(/^[0-9a-f]{24}$/),
      messageId: expect.stringMatching(/^[0-9a-f]{24}$/)
    });
    // thứ tự: ack, start, rồi mới tới delta, cuối cùng done
    expect(names(log)).toEqual([
      "ack",
      "handbook:start",
      "handbook:delta",
      "handbook:delta",
      "handbook:done"
    ]);
    expect(eventsOf(log, "handbook:start")[0].payload).toEqual({
      clientId: id,
      conversationId: ack.conversationId,
      messageId: ack.messageId
    });
    expect(eventsOf(log, "handbook:delta").map((e) => e.payload)).toEqual([
      { messageId: ack.messageId, text: "Theo Điều 12, " },
      { messageId: ack.messageId, text: "bạn được nghỉ 12 ngày." }
    ]);
    expect(eventsOf(log, "handbook:done")[0].payload).toEqual({
      messageId: ack.messageId,
      text: "Theo Điều 12, bạn được nghỉ 12 ngày.",
      truncated: false,
      citations: [
        {
          documentCode: "NOI_QUY@1",
          documentTitle: "Nội quy lao động (mẫu)",
          label: "Nội quy – Điều 12",
          articleIdx: 12,
          citedText:
            "1. Người lao động làm việc đủ 12 tháng được nghỉ phép năm 12 ngày làm việc, hưởng nguyên lương."
        }
      ]
    });
    const stored = await HandbookMessageModel.findById(ack.messageId).lean();
    expect(stored).toMatchObject({
      status: "done",
      content: "Theo Điều 12, bạn được nghỉ 12 ngày."
    });
  });

  it("MỌI tab của người dùng đều nhận sự kiện; người dùng khác không nhận gì", async () => {
    const tabOne = await connect(alice.token);
    const tabTwo = await connect(alice.token);
    const other = await connect(bob.token);

    const ack = await askVia(tabOne.socket, {
      conversationId: null,
      question: "Q",
      clientId: clientId()
    });
    await waitFor(() => eventsOf(tabTwo.log, "handbook:done")[0], 3000, "done ở tab 2");
    await waitFor(() => eventsOf(tabOne.log, "handbook:done")[0], 3000, "done ở tab 1");
    await sleep(50);

    expect(eventsOf(tabTwo.log, "handbook:start")[0].payload.messageId).toBe(ack.messageId);
    expect(names(tabTwo.log)).toEqual([
      "handbook:start",
      "handbook:delta",
      "handbook:delta",
      "handbook:done"
    ]);
    expect(names(other.log)).toEqual([]);
  });

  it("tiếp tục hội thoại cũ và đủ 8 mã lỗi theo hợp đồng qua ack", async () => {
    const { socket } = await connect(alice.token);

    const first = await askVia(socket, {
      conversationId: null,
      question: "Q1",
      clientId: clientId()
    });
    await settledAnswer(first.messageId);

    // CONVERSATION_LOCKED: hội thoại không tồn tại
    expect(
      await askVia(socket, {
        conversationId: "64b000000000000000000099",
        question: "Q",
        clientId: clientId()
      })
    ).toMatchObject({ ok: false, code: "CONVERSATION_LOCKED" });

    // TURN_LIMIT
    process.env.HANDBOOK_MAX_TURNS = "1";
    expect(
      await askVia(socket, {
        conversationId: first.conversationId,
        question: "Q2",
        clientId: clientId()
      })
    ).toMatchObject({ ok: false, code: "TURN_LIMIT" });
    delete process.env.HANDBOOK_MAX_TURNS;

    // tiếp tục hội thoại cũ thành công
    const second = await askVia(socket, {
      conversationId: first.conversationId,
      question: "Q2",
      clientId: clientId()
    });
    expect(second).toMatchObject({ ok: true, conversationId: first.conversationId });
    await settledAnswer(second.messageId);

    // QUOTA_EXCEEDED
    process.env.HANDBOOK_DAILY_QUOTA = "2";
    expect(
      await askVia(socket, { conversationId: null, question: "Q3", clientId: clientId() })
    ).toMatchObject({ ok: false, code: "QUOTA_EXCEEDED" });
    delete process.env.HANDBOOK_DAILY_QUOTA;

    // CONVERSATION_LOCKED: sau khi publish phiên bản mới
    const draft = await importHandbookDraft({ manifest: clone(sampleManifest) as any });
    await publishHandbookVersion({ versionNo: draft.versionNo });
    expect(
      await askVia(socket, {
        conversationId: first.conversationId,
        question: "Q4",
        clientId: clientId()
      })
    ).toMatchObject({ ok: false, code: "CONVERSATION_LOCKED" });

    // AI_UNAVAILABLE khi chưa cấu hình
    answerer.configured = false;
    expect(
      await askVia(socket, { conversationId: null, question: "Q5", clientId: clientId() })
    ).toMatchObject({ ok: false, code: "AI_UNAVAILABLE" });
    answerer.configured = true;

    // NO_ACTIVE_HANDBOOK
    await HandbookVersionModel.updateMany({}, { $set: { status: "archived" } });
    expect(
      await askVia(socket, { conversationId: null, question: "Q6", clientId: clientId() })
    ).toMatchObject({ ok: false, code: "NO_ACTIVE_HANDBOOK" });
  });

  it("hỏi tiếp NGAY khi vừa nhận handbook:done (hoặc handbook:error) không bao giờ bị BUSY oan", async () => {
    const { socket, log } = await connect(alice.token);
    process.env.HANDBOOK_DAILY_QUOTA = "100";
    let conversationId: string | null = null;

    for (let i = 0; i < 12; i += 1) {
      answerer.script =
        i % 4 === 3 ? failWith("overloaded", ["x"]) : streamText(["a", "b"], { delayMs: 0 });
      const before = log.length;
      const ack = await askVia(socket, { conversationId, question: `Q${i}`, clientId: clientId() });
      expect(ack).toMatchObject({ ok: true });
      conversationId = ack.conversationId;
      // vừa thấy sự kiện kết thúc là hỏi tiếp ngay, không chờ gì thêm
      await waitFor(
        () =>
          log
            .slice(before)
            .find((e) => e.event === "handbook:done" || e.event === "handbook:error"),
        3000,
        `kết thúc lượt ${i}`
      );
    }
    expect(await HandbookConversationModel.countDocuments({})).toBe(1);
  });

  it("BUSY qua socket khi đang có câu trả lời của chính mình; ack lỗi luôn có `message`", async () => {
    const { socket } = await connect(alice.token);
    const gate = controllable();
    answerer.script = gate.script;

    const first = await askVia(socket, {
      conversationId: null,
      question: "Q1",
      clientId: clientId()
    });
    await gate.hasStarted;
    const busy = await askVia(socket, {
      conversationId: null,
      question: "Q2",
      clientId: clientId()
    });

    expect(busy).toMatchObject({ ok: false, code: "BUSY" });
    expect(typeof busy.message).toBe("string");
    gate.release();
    await settledAnswer(first.messageId);
  });

  it("REFUSED: không stream chữ nào, chỉ nhận handbook:error", async () => {
    const { socket, log } = await connect(alice.token);
    answerer.script = streamText(["[NGOAI_PHAM_VI]"]);

    const ack = await askVia(socket, {
      conversationId: null,
      question: "Giá vàng?",
      clientId: clientId()
    });
    await waitFor(() => eventsOf(log, "handbook:error")[0], 3000, "handbook:error");

    expect(names(log)).toEqual(["handbook:start", "handbook:error"]);
    expect(eventsOf(log, "handbook:error")[0].payload).toEqual({
      messageId: ack.messageId,
      code: "REFUSED"
    });
  });

  it("AI_UNAVAILABLE giữa chừng: nhận một phần chữ rồi handbook:error", async () => {
    const { socket, log } = await connect(alice.token);
    answerer.script = failWith("overloaded", ["Một phần"]);

    const ack = await askVia(socket, { conversationId: null, question: "Q", clientId: clientId() });
    await waitFor(() => eventsOf(log, "handbook:error")[0], 3000, "handbook:error");

    expect(names(log)).toEqual(["handbook:start", "handbook:delta", "handbook:error"]);
    expect(eventsOf(log, "handbook:error")[0].payload).toEqual({
      messageId: ack.messageId,
      code: "AI_UNAVAILABLE"
    });
    expect((await HandbookUsageModel.findOne({ account: alice.accountId }))?.used).toBe(0);
  });

  it("mất kết nối giữa chừng KHÔNG hủy câu trả lời: vẫn lưu đầy đủ để xem lại trong lịch sử", async () => {
    const { socket } = await connect(alice.token);
    const gate = controllable();
    answerer.script = gate.script;
    const ack = await askVia(socket, { conversationId: null, question: "Q", clientId: clientId() });
    await gate.hasStarted;

    socket.disconnect();
    await sleep(50);
    gate.release();

    await settledAnswer(ack.messageId);
    expect(runningAnswers.size).toBe(0);
  });
});

describe("phân quyền & dữ liệu vào bất thường", () => {
  it("không có quyền handbook_assistant.use → FORBIDDEN, không tạo gì", async () => {
    const { socket, log } = await connect(outsider.token);
    const ack = await askVia(socket, { conversationId: null, question: "Q", clientId: clientId() });

    expect(ack).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(names(log)).toEqual([]);
    expect(await HandbookMessageModel.countDocuments({})).toBe(0);
    expect(await HandbookUsageModel.countDocuments({})).toBe(0);
    expect(answerer.calls).toHaveLength(0);
  });

  it("socket chưa xác thực (không token) → FORBIDDEN", async () => {
    const { socket } = await connect();
    expect(
      await askVia(socket, { conversationId: null, question: "Q", clientId: clientId() })
    ).toMatchObject({
      ok: false,
      code: "FORBIDDEN"
    });
  });

  it("quyền bị thu hồi thì có hiệu lực ngay sau khi xoá cache quyền", async () => {
    const { socket } = await connect(alice.token);
    const ok = await askVia(socket, { conversationId: null, question: "Q1", clientId: clientId() });
    expect(ok.ok).toBe(true);
    await settledAnswer(ok.messageId);

    await EmployeePermissionProfileModel.deleteOne({ employeeId: alice.employeeId });
    redisMock.__store.clear(); // đúng thao tác invalidatePermissionCache
    expect(
      await askVia(socket, { conversationId: null, question: "Q2", clientId: clientId() })
    ).toMatchObject({
      ok: false,
      code: "FORBIDDEN"
    });
  });

  it.each([
    ["không có payload", undefined],
    ["payload là chuỗi", "xin chào"],
    ["thiếu câu hỏi", { conversationId: null, clientId: "c" }],
    ["thiếu clientId", { conversationId: null, question: "Q" }],
    ["câu hỏi quá dài", { conversationId: null, question: "x".repeat(1001), clientId: "c" }],
    ["conversationId sai kiểu", { conversationId: 5, question: "Q", clientId: "c" }]
  ])("payload bất thường (%s) → ack lỗi, server không sập", async (_name, payload) => {
    const { socket } = await connect(alice.token);
    const ack = await askVia(socket, payload);
    expect(ack.ok).toBe(false);
    expect(["BAD_REQUEST", "CONVERSATION_LOCKED"]).toContain(ack.code);
    expect(await HandbookMessageModel.countDocuments({})).toBe(0);

    // vẫn hỏi bình thường được sau đó
    expect(
      (await askVia(socket, { conversationId: null, question: "Q", clientId: clientId() })).ok
    ).toBe(true);
  });

  it("không gửi callback (ack) thì server vẫn chạy bình thường và không ném lỗi", async () => {
    const { socket, log } = await connect(alice.token);
    socket.emit("handbook:ask", { conversationId: null, question: "Q", clientId: clientId() });
    await waitFor(() => eventsOf(log, "handbook:done")[0], 3000, "handbook:done");
  });
});

describe("hủy qua socket (handbook:cancel)", () => {
  it("hủy từ CHÍNH tab đang hỏi: nhận handbook:error CANCELLED, AI được báo hủy", async () => {
    const { socket, log } = await connect(alice.token);
    const gate = controllable(["Đang ", "trả lời"]);
    answerer.script = gate.script;
    const ack = await askVia(socket, { conversationId: null, question: "Q", clientId: clientId() });
    await gate.hasStarted;

    socket.emit("handbook:cancel", { messageId: ack.messageId });
    await waitFor(() => eventsOf(log, "handbook:error")[0], 3000, "handbook:error");

    expect(eventsOf(log, "handbook:error")[0].payload).toEqual({
      messageId: ack.messageId,
      code: "CANCELLED"
    });
    expect(eventsOf(log, "handbook:done")).toHaveLength(0);
    expect(await HandbookMessageModel.findById(ack.messageId)).toMatchObject({
      status: "cancelled",
      content: "Đang trả lời"
    });
  });

  it("hủy từ một TAB KHÁC của cùng tài khoản vẫn được; người khác thì không", async () => {
    const tabOne = await connect(alice.token);
    const tabTwo = await connect(alice.token);
    const stranger = await connect(bob.token);
    const gate = controllable();
    answerer.script = gate.script;
    const ack = await askVia(tabOne.socket, {
      conversationId: null,
      question: "Q",
      clientId: clientId()
    });
    await gate.hasStarted;

    stranger.socket.emit("handbook:cancel", { messageId: ack.messageId });
    await sleep(80);
    expect(runningAnswers.get(ack.messageId)?.controller.signal.aborted).toBe(false);

    tabTwo.socket.emit("handbook:cancel", { messageId: ack.messageId });
    await waitFor(() => eventsOf(tabOne.log, "handbook:error")[0], 3000, "CANCELLED ở tab 1");
    await waitFor(() => eventsOf(tabTwo.log, "handbook:error")[0], 3000, "CANCELLED ở tab 2");
    expect(eventsOf(stranger.log, "handbook:error")).toHaveLength(0);
  });

  it("hủy với payload bất thường hoặc có ack không làm sập server", async () => {
    const { socket } = await connect(alice.token);
    socket.emit("handbook:cancel");
    socket.emit("handbook:cancel", "abc");
    socket.emit("handbook:cancel", { messageId: { $ne: null } });
    const reply = await new Promise<any>((resolve) => {
      socket.emit("handbook:cancel", { messageId: "64b000000000000000000099" }, resolve);
    });
    expect(reply).toEqual({ ok: true });
    expect(
      (await askVia(socket, { conversationId: null, question: "Q", clientId: clientId() })).ok
    ).toBe(true);
  });
});

describe("tương thích với chat người–người đang chạy", () => {
  it("handbook:* không làm hỏng sự kiện chat sẵn có (join room theo tài khoản vẫn hoạt động)", async () => {
    const { socket } = await connect(alice.token);
    const sockets = await server.in(`account:${alice.accountId}`).fetchSockets();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].data.userInfoId).toBe(alice.employeeId);
    expect(socket.connected).toBe(true);
  });
});
