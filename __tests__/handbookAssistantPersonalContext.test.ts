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
import { prepareAsk } from "../src/modules/handbook-assistant/application/ask-question.service";
import {
  createSocketEventSink,
  setupHandbookAssistantSocket
} from "../src/modules/handbook-assistant/interface/handbook-assistant.socket";
import { runningAnswers } from "../src/modules/handbook-assistant/application/running-answers.registry";
import { clearPromptArticleCache } from "../src/modules/handbook-assistant/application/prompt-articles.service";
import type { PersonalContextProvider } from "../src/modules/handbook-assistant/application/ports/personal-context.port";
import type { PromptArticle } from "../src/modules/handbook-assistant/application/ports/handbook-answerer.port";
import { acquireBusyLock } from "../src/modules/handbook-assistant/infrastructure/busy-lock";
import {
  PERSONAL_CONTEXT_TITLE,
  SYSTEM_PROMPT,
  buildPrompt,
  formatPersonalContext
} from "../src/modules/handbook-assistant/infrastructure/ai/prompt-builder";
import { REFUSAL_SENTINEL } from "../src/modules/handbook-assistant/domain/refusal-sentinel";
import { createHandbookPersonalContext } from "../src/workflows/handbook-personal-context.workflow";
import AccountModel from "../src/models/AccountModel";
import UserInfoModel from "../src/models/UserInfoModel";
import LeaveBalanceModel from "../src/models/LeaveBalanceModel";
import HandbookVersionModel from "../src/models/HandbookVersionModel";
import HandbookArticleModel from "../src/models/HandbookArticleModel";
import HandbookConversationModel from "../src/models/HandbookConversationModel";
import HandbookMessageModel from "../src/models/HandbookMessageModel";
import HandbookUsageModel from "../src/models/HandbookUsageModel";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import { LEAVE_BALANCE_REASON } from "../src/constants";
import sampleManifest from "../scripts/handbook/sample-handbook.manifest.json";
import { grantHandbookAssistantPermission } from "./helpers/grantHandbookAssistantPermission";
import {
  FakeAnswerer,
  RecordingEvents,
  createDeps,
  sleep,
  streamText,
  waitFor
} from "./helpers/handbookAssistantFakes";
/* eslint-enable import/first */

// chatSocket.js (JS) được nạp qua require để dùng đúng middleware xác thực thật (JWT + room account:<id>).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const setupChatSocket = require("../src/sockets/chatSocket");

const article = (over: Partial<PromptArticle> = {}): PromptArticle => ({
  documentCode: "NOI_QUY",
  documentTitle: "Nội quy lao động",
  articleIdx: 12,
  label: "Nội quy – Điều 12",
  title: "Điều 12. Nghỉ phép năm",
  chapter: "Chương IV",
  blocks: ["1. Nghỉ phép năm 12 ngày.", "2. Ứng trước tối đa 1 ngày."],
  ...over
});

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : (content as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

describe("formatPersonalContext — khối dữ liệu cá nhân của chính người hỏi", () => {
  it("không có dữ liệu → không có khối nào", () => {
    expect(formatPersonalContext(null)).toBeNull();
    expect(formatPersonalContext(undefined)).toBeNull();
  });

  it("nêu số ngày phép còn lại, ghi rõ chỉ của chính người hỏi", () => {
    const block = formatPersonalContext({ leaveBalanceDays: 8 }) as string;
    expect(block).toContain(PERSONAL_CONTEXT_TITLE);
    expect(block).toMatch(/CHỈ của chính người đang hỏi/);
    expect(block).toContain("Số ngày phép năm còn lại: 8 ngày");
  });

  it("số lẻ viết kiểu Việt (dấu phẩy) và làm tròn tối đa 2 chữ số", () => {
    expect(formatPersonalContext({ leaveBalanceDays: 7.5 })).toContain("còn lại: 7,5 ngày");
    expect(formatPersonalContext({ leaveBalanceDays: 0.1 + 0.2 })).toContain("còn lại: 0,3 ngày");
    expect(formatPersonalContext({ leaveBalanceDays: 0 })).toContain("còn lại: 0 ngày");
  });

  it("số dư âm = đã ứng trước, vẫn hiện 0 ngày còn lại", () => {
    const block = formatPersonalContext({ leaveBalanceDays: -1 }) as string;
    expect(block).toContain("còn lại: 0 ngày (số dư đang âm 1 ngày, tức đã ứng trước phép)");
  });

  it("không tra được (null/NaN) → nói rõ chưa tra được, KHÔNG phải 0 ngày", () => {
    for (const days of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const block = formatPersonalContext({ leaveBalanceDays: days }) as string;
      expect(block).toContain("chưa tra được lúc này");
      expect(block).not.toMatch(/còn lại: 0 ngày/);
    }
  });
});

describe("buildPrompt với dữ liệu cá nhân", () => {
  const articles = [article()];
  const base = { articles, cacheTtl: "1h" as const };

  it("không có dữ liệu cá nhân → prompt y hệt như trước (chuỗi thuần ở tin hiện tại)", () => {
    const withHistory = buildPrompt({
      ...base,
      history: [{ question: "Q1", answer: "A1" }],
      question: "Q2"
    });
    expect(withHistory.messages.slice(1).map((m) => m.content)).toEqual(["A1", "Q2"]);

    const first = buildPrompt({ ...base, history: [], question: "Q1" });
    expect((first.messages[0].content as any[]).at(-1)).toEqual({ type: "text", text: "Q1" });
    expect(JSON.stringify(first.messages)).not.toContain(PERSONAL_CONTEXT_TITLE);
  });

  it("lượt đầu: khối dữ liệu đứng SAU các văn bản (và sau điểm cache), ngay trước câu hỏi", () => {
    const prompt = buildPrompt({
      ...base,
      history: [],
      question: "Tôi còn bao nhiêu ngày phép?",
      personal: { leaveBalanceDays: 8 }
    });
    const blocks = prompt.messages[0].content as any[];
    expect(blocks.map((b) => b.type)).toEqual(["document", "text", "text"]);
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(blocks[1].text).toContain("Số ngày phép năm còn lại: 8 ngày");
    expect(blocks[2]).toEqual({ type: "text", text: "Tôi còn bao nhiêu ngày phép?" });
  });

  it("các lượt sau: khối dữ liệu CHỈ nằm ở tin user hiện tại, không lọt vào tin đầu (tiền tố được cache)", () => {
    const prompt = buildPrompt({
      ...base,
      history: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" }
      ],
      question: "Tôi còn bao nhiêu ngày phép?",
      personal: { leaveBalanceDays: 8 }
    });
    const m = prompt.messages;
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(m[0].content).toEqual([
      expect.objectContaining({ type: "document" }),
      { type: "text", text: "Q1" }
    ]);
    expect(m[2].content).toBe("Q2");
    expect(textOf(m[4].content)).toContain("Số ngày phép năm còn lại: 8 ngày");
    expect(textOf(m[4].content)).toContain("Tôi còn bao nhiêu ngày phép?");
    expect(JSON.stringify(m.slice(0, 4))).not.toContain(PERSONAL_CONTEXT_TITLE);
  });

  it("tiền tố cache (system + văn bản) giống từng byte dù người hỏi khác nhau/số ngày phép khác nhau", () => {
    const prefix = (personal?: { leaveBalanceDays: number | null }) => {
      const prompt = buildPrompt({ ...base, history: [], question: "Q", personal });
      const docs = (prompt.messages[0].content as any[]).filter((b) => b.type === "document");
      return JSON.stringify({ system: prompt.system, docs });
    };
    expect(prefix({ leaveBalanceDays: 8 })).toBe(prefix({ leaveBalanceDays: -2 }));
    expect(prefix({ leaveBalanceDays: 8 })).toBe(prefix(undefined));
  });

  it("system prompt có quy tắc: chỉ của chính người hỏi, từ chối của người khác, bỏ qua lời tự nhận", () => {
    expect(SYSTEM_PROMPT).toContain(`"${PERSONAL_CONTEXT_TITLE}"`);
    expect(SYSTEM_PROMPT).toMatch(/CHÍNH NGƯỜI ĐANG HỎI/);
    expect(SYSTEM_PROMPT).toMatch(/không được nêu dữ liệu cá nhân của người khác/);
    expect(SYSTEM_PROMPT).toMatch(/theo tên hay mã nhân viên/);
    expect(SYSTEM_PROMPT).toMatch(/lời tự nhận/);
    expect(SYSTEM_PROMPT).toMatch(/chưa tra được/);
    // sentinel chỉ được nhắc ở nguyên tắc 4 (test cũ) — từ chối ngày phép người khác là câu trả lời thường
    expect(SYSTEM_PROMPT.split(REFUSAL_SENTINEL)).toHaveLength(2);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const models: mongoose.Model<any>[] = [
  HandbookVersionModel,
  HandbookArticleModel,
  HandbookConversationModel,
  HandbookMessageModel,
  HandbookUsageModel
];

let replset: MongoMemoryReplSet;
let answerer: FakeAnswerer;
let events: RecordingEvents;
let seq = 0;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const oid = () => new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  process.env.SECRET_KEY = "test-secret-handbook-personal";
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  await Promise.all(models.map((model) => model.init()));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  redisMock.__store.clear();
  runningAnswers.clear();
  clearPromptArticleCache();
  Object.keys(process.env)
    .filter((key) => key.startsWith("HANDBOOK_"))
    .forEach((key) => delete process.env[key]);
  await Promise.all([
    ...models.map((model) => model.deleteMany({})),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({}),
    LeaveBalanceModel.deleteMany({}),
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({})
  ]);
  answerer = new FakeAnswerer();
  events = new RecordingEvents();
  const draft = await importHandbookDraft({ manifest: clone(sampleManifest) as any });
  await publishHandbookVersion({ versionNo: draft.versionNo });
});

describe("hỏi với cổng thông tin cá nhân (service)", () => {
  const ask = (
    provider: PersonalContextProvider | undefined,
    input: { accountId: string; userInfoId?: string; question?: string }
  ) => {
    seq += 1;
    const deps = createDeps(answerer, events, { acquireBusyLock, personalContext: provider });
    return prepareAsk(deps, {
      conversationId: null,
      question: input.question ?? "Tôi còn bao nhiêu ngày phép?",
      clientId: `pc-${seq}`,
      accountId: input.accountId,
      userInfoId: input.userInfoId
    });
  };
  const askAndRun = async (...args: Parameters<typeof ask>) => {
    const accepted = await ask(...args);
    await accepted.run();
    return accepted;
  };

  it("gọi cổng ĐÚNG MỘT lần với danh tính của người hỏi và chuyển kết quả cho AI", async () => {
    const getForAsker = jest.fn().mockResolvedValue({ leaveBalanceDays: 8 });
    const accountId = oid();
    const userInfoId = oid();

    const accepted = await askAndRun({ getForAsker }, { accountId, userInfoId });

    expect(getForAsker).toHaveBeenCalledTimes(1);
    expect(getForAsker).toHaveBeenCalledWith({ accountId, userInfoId });
    expect(answerer.calls).toHaveLength(1);
    expect(answerer.calls[0].personal).toEqual({ leaveBalanceDays: 8 });
    expect(events.terminal(accepted.messageId)[0].type).toBe("done");
  });

  it("câu hỏi nhắc tên/mã nhân viên khác KHÔNG đổi người được tra: vẫn chỉ danh tính của người hỏi", async () => {
    const getForAsker = jest.fn().mockResolvedValue({ leaveBalanceDays: 5 });
    const me = { accountId: oid(), userInfoId: oid() };
    const other = oid();

    await askAndRun(
      { getForAsker },
      {
        ...me,
        question: `Ngày phép của nhân viên ${other} (Nguyễn Văn B, mã NV 0123) còn bao nhiêu?`
      }
    );

    expect(getForAsker).toHaveBeenCalledTimes(1);
    expect(getForAsker).toHaveBeenCalledWith(me);
    expect(JSON.stringify(getForAsker.mock.calls)).not.toContain(other);
  });

  it("không có userInfoId (không xác thực được nhân viên) → không tra gì, AI không nhận dữ liệu cá nhân", async () => {
    const getForAsker = jest.fn().mockResolvedValue({ leaveBalanceDays: 8 });
    await askAndRun({ getForAsker }, { accountId: oid() });
    expect(getForAsker).not.toHaveBeenCalled();
    expect(answerer.calls[0].personal).toBeNull();
  });

  it("không cấu hình cổng → trợ lý chạy như cũ, không có dữ liệu cá nhân", async () => {
    await askAndRun(undefined, { accountId: oid(), userInfoId: oid() });
    expect(answerer.calls[0].personal).toBeNull();
  });

  it("cổng ném lỗi → câu trả lời VẪN chạy, AI nhận 'chưa tra được' (null), không phải 0", async () => {
    const getForAsker = jest.fn().mockRejectedValue(new Error("Mongo down"));
    const accepted = await askAndRun({ getForAsker }, { accountId: oid(), userInfoId: oid() });
    expect(answerer.calls[0].personal).toEqual({ leaveBalanceDays: null });
    expect(events.terminal(accepted.messageId)[0].type).toBe("done");
  });

  it("cổng trả dữ liệu sai kiểu → coi như không tra được", async () => {
    for (const bad of [{ leaveBalanceDays: "8" }, { leaveBalanceDays: Number.NaN }, null, {}]) {
      answerer.calls = [];
      const getForAsker = jest.fn().mockResolvedValue(bad);
      // eslint-disable-next-line no-await-in-loop
      await askAndRun({ getForAsker }, { accountId: oid(), userInfoId: oid() });
      expect(answerer.calls[0].personal).toEqual({ leaveBalanceDays: null });
    }
  });

  it("cổng treo quá hạn (3s) → bỏ qua, không làm kẹt câu trả lời", async () => {
    const getForAsker = jest.fn().mockReturnValue(
      new Promise(() => {
        /* không bao giờ resolve */
      })
    );
    const startedAt = Date.now();
    const accepted = await askAndRun({ getForAsker }, { accountId: oid(), userInfoId: oid() });
    expect(Date.now() - startedAt).toBeLessThan(6000);
    expect(answerer.calls[0].personal).toEqual({ leaveBalanceDays: null });
    expect(events.terminal(accepted.messageId)[0].type).toBe("done");
  }, 20000);
});

describe("createHandbookPersonalContext + socket thật: chỉ ngày phép của CHÍNH người hỏi", () => {
  interface Employee {
    accountId: string;
    employeeId: string;
    token: string;
  }

  let httpServer: http.Server;
  let server: Server;
  let url: string;
  let alice: Employee;
  let bob: Employee;
  const clients: ClientSocket[] = [];

  async function createEmployee(): Promise<Employee> {
    seq += 1;
    const account = await AccountModel.create({
      username: `hbpc_${Date.now()}_${seq}`,
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
      ma_nv: `PC${Date.now()}${seq}`,
      employment_type: "fulltime"
    });
    await grantHandbookAssistantPermission(info._id);
    return {
      accountId: String(account._id),
      employeeId: String(info._id),
      token: jwt.sign({ id: String(account._id) }, process.env.SECRET_KEY as string)
    };
  }

  const ledger = (employeeId: string, amount: number) =>
    LeaveBalanceModel.create({
      user_id: employeeId,
      amount,
      reason: LEAVE_BALANCE_REASON.MONTHLY_ACCRUAL,
      ref_type: "system"
    });

  async function connect(token: string): Promise<ClientSocket> {
    const socket = connectClient(url, {
      transports: ["websocket"],
      auth: { token },
      reconnection: false,
      forceNew: true
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  }

  const askVia = (socket: ClientSocket, payload: unknown) =>
    new Promise<any>((resolve) => {
      socket.emit("handbook:ask", payload, (ack: unknown) => resolve(ack));
    });

  beforeAll(async () => {
    httpServer = http.createServer();
    server = new Server(httpServer, { transports: ["websocket"] });
    setupChatSocket(server); // middleware xác thực thật + room account:<id>
    // Cổng THẬT (workflows/) → từ socket tới sổ ngày phép thật. `answerer` được tạo lại ở beforeEach nên
    // gọi qua hàm bọc (đọc biến lúc gọi, không phải lúc dựng server).
    setupHandbookAssistantSocket(
      server,
      createDeps(
        {
          isConfigured: () => true,
          answer: (request, callbacks) => {
            answerer.calls.push(request);
            return answerer.script(request, callbacks);
          }
        },
        createSocketEventSink(server),
        { acquireBusyLock, personalContext: createHandbookPersonalContext() }
      )
    );
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    clients.splice(0).forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(async () => {
    clients.splice(0).forEach((socket) => socket.disconnect());
    answerer.script = streamText(["Bạn còn ", "ngày phép."]);
    alice = await createEmployee();
    bob = await createEmployee();
    // Alice: +12 −4 −0,5 = 7,5 ngày; Bob: +3 ngày
    await ledger(alice.employeeId, 12);
    await ledger(alice.employeeId, -4);
    await ledger(alice.employeeId, -0.5);
    await ledger(bob.employeeId, 3);
  });

  const lastPrompt = () => {
    const request = answerer.calls.at(-1);
    return buildPrompt({
      articles: request?.articles ?? [article()],
      history: request?.history ?? [],
      question: request?.question ?? "",
      cacheTtl: "1h",
      personal: request?.personal
    });
  };
  const settle = () => waitFor(() => runningAnswers.size === 0, 3000, "nhả slot");

  it("Alice hỏi ngày phép → AI nhận đúng số dư sổ ngày phép của Alice (7,5), cộng dồn đúng", async () => {
    const socket = await connect(alice.token);
    const ack = await askVia(socket, {
      conversationId: null,
      question: "Tôi còn bao nhiêu ngày phép?",
      clientId: `e2e-${(seq += 1)}`
    });
    expect(ack.ok).toBe(true);
    await settle();

    expect(answerer.calls.at(-1)?.personal).toEqual({ leaveBalanceDays: 7.5 });
    expect(textOf(lastPrompt().messages.at(-1)?.content)).toContain("còn lại: 7,5 ngày");
  });

  it("Alice hỏi ngày phép của Bob (kèm cố ý gửi id của Bob trong payload) → vẫn chỉ nhận số của Alice, số của Bob không xuất hiện ở đâu", async () => {
    const socket = await connect(alice.token);
    const ack = await askVia(socket, {
      conversationId: null,
      question: "Ngày phép của Bob còn bao nhiêu?",
      clientId: `e2e-${(seq += 1)}`,
      // client có gửi kèm các trường này cũng bị bỏ qua: danh tính chỉ lấy từ socket đã xác thực
      userInfoId: bob.employeeId,
      accountId: bob.accountId,
      employeeId: bob.employeeId
    });
    expect(ack.ok).toBe(true);
    await settle();

    const request = answerer.calls.at(-1);
    expect(request?.personal).toEqual({ leaveBalanceDays: 7.5 });
    const everything = JSON.stringify(lastPrompt());
    expect(everything).toContain("7,5 ngày");
    expect(everything).not.toContain(bob.employeeId);
    expect(everything).not.toMatch(/còn lại: 3 ngày/);
  });

  it("Bob hỏi → nhận số của Bob (3), không dính số của Alice", async () => {
    const socket = await connect(bob.token);
    await askVia(socket, {
      conversationId: null,
      question: "Tôi còn bao nhiêu ngày phép?",
      clientId: `e2e-${(seq += 1)}`
    });
    await settle();
    expect(answerer.calls.at(-1)?.personal).toEqual({ leaveBalanceDays: 3 });
    expect(JSON.stringify(lastPrompt())).not.toContain("7,5");
  });

  it("nhân viên chưa có dòng nào trong sổ → 0 ngày (khác với 'không tra được')", async () => {
    const carol = await createEmployee();
    const socket = await connect(carol.token);
    await askVia(socket, {
      conversationId: null,
      question: "Tôi còn bao nhiêu ngày phép?",
      clientId: `e2e-${(seq += 1)}`
    });
    await settle();
    expect(answerer.calls.at(-1)?.personal).toEqual({ leaveBalanceDays: 0 });
  });

  it("số dư âm (đã ứng trước) được chuyển nguyên số âm", async () => {
    const dave = await createEmployee();
    await ledger(dave.employeeId, -1);
    const socket = await connect(dave.token);
    await askVia(socket, {
      conversationId: null,
      question: "Tôi còn bao nhiêu ngày phép?",
      clientId: `e2e-${(seq += 1)}`
    });
    await settle();
    expect(answerer.calls.at(-1)?.personal).toEqual({ leaveBalanceDays: -1 });
    expect(textOf(lastPrompt().messages.at(-1)?.content)).toContain("đã ứng trước phép");
  });

  it("sổ ngày phép lỗi → cổng trả null (chưa tra được), câu trả lời vẫn hoàn tất", async () => {
    const spy = jest.spyOn(LeaveBalanceModel, "aggregate").mockImplementation(() => {
      throw new Error("ledger down");
    });
    try {
      const socket = await connect(alice.token);
      const ack = await askVia(socket, {
        conversationId: null,
        question: "Tôi còn bao nhiêu ngày phép?",
        clientId: `e2e-${(seq += 1)}`
      });
      expect(ack.ok).toBe(true);
      await settle();
      await sleep(20);
      expect(answerer.calls.at(-1)?.personal).toEqual({ leaveBalanceDays: null });
    } finally {
      spy.mockRestore();
    }
  });
});
