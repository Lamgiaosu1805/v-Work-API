import http from "http";
import { AddressInfo } from "net";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { io as connectClient, Socket as ClientSocket } from "socket.io-client";

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
// Quyền của từng nhân viên do test quyết định (không cần Mongo / Redis / seed role thật).
jest.mock("../src/core/authorization/can-employee", () => ({ loadEmployeeAbility: jest.fn() }));

/* eslint-disable import/first */
import { loadEmployeeAbility } from "../src/core/authorization/can-employee";
import { TicketWatchAuthorizer } from "../src/modules/ticket/application/ports";
import { TicketWatchService } from "../src/modules/ticket/application/ticket-watch.service";
import { setupTicketSocket } from "../src/modules/ticket/interface/ticket.socket";
import {
  MAX_WATCHED_TICKETS_PER_SOCKET,
  SocketIoTicketRealtime
} from "../src/modules/ticket/infrastructure/ticket-realtime";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setIO } = require("../src/sockets/ioRegistry");
/* eslint-enable import/first */

const newId = () => String(new mongoose.Types.ObjectId());
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

type LogEntry = { event: string; payload: any };

// ---- phần 1: kênh socket (phòng ticket:<id>) với bộ kiểm quyền giả -------------------------------------------------

class FakeAuthorizer implements TicketWatchAuthorizer {
  // ticketId → những người còn được xem
  readonly allowed = new Map<string, Set<string>>();

  lostAccessCalls = 0;

  allow(ticketId: string, ...employeeIds: string[]) {
    this.allowed.set(ticketId, new Set(employeeIds));
  }

  async canWatch(employeeId: string, ticketId: string) {
    return this.allowed.get(ticketId)?.has(employeeId) ?? false;
  }

  async lostAccess(ticketId: string, employeeIds: string[]) {
    this.lostAccessCalls += 1;
    const ok = this.allowed.get(ticketId) ?? new Set<string>();
    return new Set(employeeIds.filter((id) => !ok.has(id)));
  }
}

let httpServer: http.Server;
let server: Server;
let url: string;
let authorizer: FakeAuthorizer;
let realtime: SocketIoTicketRealtime;
const clients: ClientSocket[] = [];

// Token giả: "user:<id>" → socket.data.userInfoId = <id> (thay cho middleware JWT thật của chatSocket).
async function connect(userId?: string): Promise<{ socket: ClientSocket; log: LogEntry[] }> {
  const socket = connectClient(url, {
    transports: ["websocket"],
    auth: userId ? { token: `user:${userId}` } : {},
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

const watch = (socket: ClientSocket, ticketId: unknown) =>
  new Promise<any>((resolve) => {
    socket.emit("ticket:watch", { ticketId }, resolve);
  });

const unwatch = (socket: ClientSocket, ticketId: string) =>
  new Promise<any>((resolve) => {
    socket.emit("ticket:unwatch", { ticketId }, resolve);
  });

const eventsOf = (log: LogEntry[], name: string) => log.filter((entry) => entry.event === name);

// Đợi để chắc chắn KHÔNG có sự kiện nào đến thêm (kiểm tra khẳng định phủ định).
const settle = () => sleep(150);

beforeAll(async () => {
  httpServer = http.createServer();
  server = new Server(httpServer, { transports: ["websocket"] });
  server.use((socket, next) => {
    const token = String(socket.handshake.auth?.token ?? "");
    if (token.startsWith("user:")) socket.data.userInfoId = token.slice("user:".length);
    next();
  });
  authorizer = new FakeAuthorizer();
  setupTicketSocket(server, authorizer);
  setIO(server);
  realtime = new SocketIoTicketRealtime(authorizer);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  clients.forEach((socket) => socket.disconnect());
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(() => {
  clients.splice(0).forEach((socket) => socket.disconnect());
  authorizer.allowed.clear();
  authorizer.lostAccessCalls = 0;
});

describe("ticket:watch / ticket:unwatch", () => {
  it("người có quyền vào được phòng và nhận ticket:changed (chỉ tín hiệu, không kèm nội dung)", async () => {
    const ticketId = newId();
    authorizer.allow(ticketId, "alice");
    const { socket, log } = await connect("alice");

    expect(await watch(socket, ticketId)).toEqual({ ok: true });
    realtime.publishChanged({ ticketId, kind: "message", actorId: "bob" });
    await settle();

    expect(eventsOf(log, "ticket:changed")).toEqual([
      {
        event: "ticket:changed",
        payload: { ticketId, kind: "message", version: null, actorId: "bob" }
      }
    ]);
  });

  it("chỉ nhận tín hiệu của ticket mình đang theo dõi", async () => {
    const watched = newId();
    const other = newId();
    authorizer.allow(watched, "alice");
    authorizer.allow(other, "alice");
    const { socket, log } = await connect("alice");

    await watch(socket, watched);
    realtime.publishChanged({ ticketId: other, kind: "message", actorId: null });
    await settle();

    expect(eventsOf(log, "ticket:changed")).toHaveLength(0);
  });

  it("người không có quyền bị từ chối và không nhận tín hiệu", async () => {
    const ticketId = newId();
    authorizer.allow(ticketId, "alice");
    const { socket, log } = await connect("mallory");

    expect(await watch(socket, ticketId)).toEqual({ ok: false, code: "forbidden" });
    realtime.publishChanged({ ticketId, kind: "updated", version: 3, actorId: "alice" });
    await settle();

    expect(eventsOf(log, "ticket:changed")).toHaveLength(0);
  });

  it("ticket không tồn tại và ticket không có quyền xem trả chung một mã (không lộ ticket hạn chế)", async () => {
    const { socket } = await connect("mallory");
    expect(await watch(socket, newId())).toEqual({ ok: false, code: "forbidden" });
  });

  it("mã ticket sai định dạng → invalid_ticket; chưa xác thực → unauthorized", async () => {
    const authed = await connect("alice");
    expect(await watch(authed.socket, "khong-phai-objectid")).toEqual({
      ok: false,
      code: "invalid_ticket"
    });
    expect(await watch(authed.socket, undefined)).toEqual({ ok: false, code: "invalid_ticket" });

    const anonymous = await connect();
    expect(await watch(anonymous.socket, newId())).toEqual({ ok: false, code: "unauthorized" });
  });

  it("ticket:unwatch → thôi nhận tín hiệu", async () => {
    const ticketId = newId();
    authorizer.allow(ticketId, "alice");
    const { socket, log } = await connect("alice");

    await watch(socket, ticketId);
    expect(await unwatch(socket, ticketId)).toEqual({ ok: true });
    realtime.publishChanged({ ticketId, kind: "message", actorId: null });
    await settle();

    expect(eventsOf(log, "ticket:changed")).toHaveLength(0);
  });

  it(`mỗi socket theo dõi tối đa ${MAX_WATCHED_TICKETS_PER_SOCKET} ticket; vào lại ticket đang theo dõi vẫn được`, async () => {
    const { socket } = await connect("alice");
    const ids = Array.from({ length: MAX_WATCHED_TICKETS_PER_SOCKET + 1 }, newId);
    ids.forEach((id) => authorizer.allow(id, "alice"));

    for (const id of ids.slice(0, MAX_WATCHED_TICKETS_PER_SOCKET)) {
      expect(await watch(socket, id)).toEqual({ ok: true });
    }
    expect(await watch(socket, ids[MAX_WATCHED_TICKETS_PER_SOCKET])).toEqual({
      ok: false,
      code: "too_many"
    });
    expect(await watch(socket, ids[0])).toEqual({ ok: true });
  });
});

describe("ticket:revoked", () => {
  it("ticket đổi và người xem mất quyền → họ nhận ticket:revoked (không nhận changed) và bị đá khỏi phòng", async () => {
    const ticketId = newId();
    authorizer.allow(ticketId, "alice", "bob");
    const alice = await connect("alice");
    const bob = await connect("bob");
    await watch(alice.socket, ticketId);
    await watch(bob.socket, ticketId);

    // Ticket bị giao lại / chuyển hạn chế: bob không còn xem được
    authorizer.allow(ticketId, "alice");
    realtime.publishChanged({ ticketId, kind: "updated", version: 4, actorId: "alice" });
    await settle();

    expect(eventsOf(alice.log, "ticket:changed")).toHaveLength(1);
    expect(eventsOf(alice.log, "ticket:revoked")).toHaveLength(0);
    expect(eventsOf(bob.log, "ticket:revoked")).toEqual([
      { event: "ticket:revoked", payload: { ticketId } }
    ]);
    expect(eventsOf(bob.log, "ticket:changed")).toHaveLength(0);

    // Đã bị đá khỏi phòng: các lần đổi sau không còn tới bob
    realtime.publishChanged({ ticketId, kind: "message", actorId: "alice" });
    await settle();
    expect(eventsOf(alice.log, "ticket:changed")).toHaveLength(2);
    expect(eventsOf(bob.log, "ticket:changed")).toHaveLength(0);
    expect(eventsOf(bob.log, "ticket:revoked")).toHaveLength(1);
  });

  it("tin nhắn mới (kind=message) không kiểm tra lại quyền", async () => {
    const ticketId = newId();
    authorizer.allow(ticketId, "alice");
    const { socket, log } = await connect("alice");
    await watch(socket, ticketId);

    realtime.publishChanged({ ticketId, kind: "message", actorId: "bob" });
    await settle();

    expect(authorizer.lostAccessCalls).toBe(0);
    expect(eventsOf(log, "ticket:changed")).toHaveLength(1);
  });

  it("phòng trống thì không tốn công kiểm quyền", async () => {
    const ticketId = newId();
    authorizer.allow(ticketId, "alice");

    realtime.publishChanged({ ticketId, kind: "updated", version: 1, actorId: null });
    await settle();

    expect(authorizer.lostAccessCalls).toBe(0);
  });

  it("nhiều tab của cùng một người: tab nào cũng nhận tín hiệu, mất quyền thì tab nào cũng bị đá", async () => {
    const ticketId = newId();
    authorizer.allow(ticketId, "alice");
    const tab1 = await connect("alice");
    const tab2 = await connect("alice");
    await watch(tab1.socket, ticketId);
    await watch(tab2.socket, ticketId);

    realtime.publishChanged({ ticketId, kind: "message", actorId: null });
    await settle();
    expect(eventsOf(tab1.log, "ticket:changed")).toHaveLength(1);
    expect(eventsOf(tab2.log, "ticket:changed")).toHaveLength(1);

    authorizer.allowed.set(ticketId, new Set());
    realtime.publishChanged({ ticketId, kind: "updated", actorId: null });
    await settle();
    expect(eventsOf(tab1.log, "ticket:revoked")).toHaveLength(1);
    expect(eventsOf(tab2.log, "ticket:revoked")).toHaveLength(1);
  });
});

// ---- phần 2: TicketWatchService dùng đúng quy tắc quyền xem của API chi tiết -----------------------------------------

describe("TicketWatchService", () => {
  const grant = (byEmployee: Record<string, string[]>) => {
    (loadEmployeeAbility as jest.Mock).mockImplementation(async (employeeId: string) => ({
      can: (action: string) => (byEmployee[employeeId] ?? []).includes(action)
    }));
  };

  const baseProps = {
    status: "open",
    visibility: "normal",
    createdBy: "creator",
    assignment: {
      mode: "none",
      departmentId: null,
      memberIds: [] as string[],
      ownerId: null as string | null,
      collaboratorIds: [] as string[]
    }
  };

  const build = (props: any) => {
    const ticketId = newId();
    const findOneById = jest.fn(async (id: string) =>
      id === ticketId ? { getProps: () => props } : null
    );
    const directory = {
      getDepartmentIdsWithAncestors: async () => [] as string[],
      getOwnDepartmentTreeEmployeeIds: async () => [] as string[]
    };
    const service = new TicketWatchService({
      tickets: { findOneById } as any,
      directory: directory as any
    });
    return { ticketId, service };
  };

  it("người tạo có ticket.view → xem được; không có ticket.view ở mức module → không", async () => {
    const { ticketId, service } = build(baseProps);
    grant({ creator: ["ticket.view"], noperm: [] });
    expect(await service.canWatch("creator", ticketId)).toBe(true);
    expect(await service.canWatch("noperm", ticketId)).toBe(false);
  });

  it("nhân viên thường không liên quan, khác phòng → không xem được ticket thường của người khác", async () => {
    const { ticketId, service } = build(baseProps);
    grant({ stranger: ["ticket.view"], handler: ["ticket.view", "ticket.handle"] });
    expect(await service.canWatch("stranger", ticketId)).toBe(false);
    // Người xử lý (ticket.handle) xem được mọi ticket thường
    expect(await service.canWatch("handler", ticketId)).toBe(true);
  });

  it("ticket hạn chế: chỉ người liên quan hoặc ticket.view_restricted", async () => {
    const { ticketId, service } = build({
      ...baseProps,
      visibility: "restricted",
      assignment: { ...baseProps.assignment, ownerId: "owner" }
    });
    grant({
      owner: ["ticket.view", "ticket.handle"],
      handlerNotOwner: ["ticket.view", "ticket.handle"],
      it: ["ticket.view", "ticket.view_restricted"]
    });
    expect(await service.canWatch("owner", ticketId)).toBe(true);
    expect(await service.canWatch("it", ticketId)).toBe(true);
    expect(await service.canWatch("handlerNotOwner", ticketId)).toBe(false);
  });

  it("ticket không tồn tại hoặc mã sai định dạng → không xem được", async () => {
    const { service } = build(baseProps);
    grant({ creator: ["ticket.view"] });
    expect(await service.canWatch("creator", newId())).toBe(false);
    expect(await service.canWatch("creator", "xyz")).toBe(false);
  });

  it("lostAccess: chỉ trả những người đã mất quyền; ticket bị xoá → tất cả mất quyền", async () => {
    const { ticketId, service } = build({
      ...baseProps,
      visibility: "restricted",
      assignment: { ...baseProps.assignment, ownerId: "owner" }
    });
    grant({ owner: ["ticket.view"], ex: ["ticket.view"] });

    expect([...(await service.lostAccess(ticketId, ["owner", "ex", "ex"]))]).toEqual(["ex"]);
    expect([...(await service.lostAccess(newId(), ["owner", "ex"]))].sort()).toEqual([
      "ex",
      "owner"
    ]);
  });
});
