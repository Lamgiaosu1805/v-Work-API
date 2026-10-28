import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { errorHandlerMiddleware } from "../../../src/core/http/error-handler.middleware";
import {
  isObjectIdString,
  optionalObjectId,
  optionalUrgency,
  parseListQuery,
  requireObjectId,
  requireResolutionCode,
  toObjectIdList
} from "../../../src/modules/ticket/interface/ticket-request-parsers";

// Kiểm tra id/enum ở rìa HTTP của module ticket: không cần Mongo — service được giả lập để biết
// request bị chặn TRƯỚC khi chạm tới service (lỗi 400 thay vì CastError → 500).

const TICKET_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-http-validation-"));
process.env.TICKET_DIR_DEV = TICKET_DIR;

const mockCommands = {
  create: jest.fn(),
  edit: jest.fn(),
  assign: jest.fn(),
  addCollaborator: jest.fn(),
  close: jest.fn(),
  linkRelated: jest.fn(),
  addMessage: jest.fn()
};
const mockQueries = { list: jest.fn() };

jest.mock("../../../src/modules/ticket/application/ticket-actor", () => ({
  buildTicketActor: jest.fn().mockResolvedValue({ employeeId: "actor" })
}));
jest.mock("../../../src/modules/ticket/application/ticket-commands.service", () => ({
  getTicketCommandService: () => mockCommands
}));
jest.mock("../../../src/modules/ticket/application/ticket-queries.service", () => ({
  getTicketQueryService: () => mockQueries
}));
jest.mock("../../../src/modules/ticket/application/ticket-config.service", () => ({
  getTicketConfigService: () => ({})
}));
jest.mock("../../../src/middlewares/authMiddleware", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.account = { _id: "account" };
    next();
  }
}));
jest.mock("../../../src/core/authorization/require-permission.middleware", () => ({
  requirePermission: () => (req: any, _res: any, next: any) => {
    req.permissionAbility = { can: () => true };
    next();
  }
}));

// eslint-disable-next-line import/first
import ticketRouter from "../../../src/modules/ticket/interface/ticket.routes";

const ID = "64b7f0c2a1b2c3d4e5f60718";
const ID2 = "64b7f0c2a1b2c3d4e5f60719";
const TICKET = "64b7f0c2a1b2c3d4e5f60700";

const app = express();
app.use(express.json());
app.use("/tickets", ticketRouter);
app.use(errorHandlerMiddleware);

beforeEach(() => {
  Object.values(mockCommands).forEach((fn) => fn.mockReset().mockResolvedValue({ id: TICKET }));
  mockQueries.list.mockReset().mockResolvedValue({ data: [], total: 0 });
});

afterAll(() => {
  fs.rmSync(TICKET_DIR, { recursive: true, force: true });
});

const validCreate = () => ({ title: "Lỗi đăng nhập", productId: ID, categoryId: ID2 });

describe("parser helper id/enum", () => {
  it("isObjectIdString chỉ nhận chuỗi 24 hex", () => {
    expect(isObjectIdString(ID)).toBe(true);
    expect(isObjectIdString("abc")).toBe(false);
    expect(isObjectIdString("aaaaaaaaaaaa")).toBe(false); // 12 ký tự: mongoose coi là hợp lệ nhưng ta không nhận
    expect(isObjectIdString(123)).toBe(false);
    expect(isObjectIdString({ $ne: "" })).toBe(false);
  });

  it("requireObjectId: thiếu → message của nơi gọi, sai định dạng → message không hợp lệ", () => {
    expect(() => requireObjectId(undefined, "Vui lòng chọn sản phẩm")).toThrow(
      "Vui lòng chọn sản phẩm"
    );
    expect(() => requireObjectId("xyz", "Vui lòng chọn sản phẩm", "Sản phẩm không hợp lệ")).toThrow(
      "Sản phẩm không hợp lệ"
    );
    expect(requireObjectId(ID, "x")).toBe(ID);
  });

  it("optionalObjectId: rỗng → undefined, sai định dạng → ném lỗi", () => {
    expect(optionalObjectId(undefined, "x")).toBeUndefined();
    expect(optionalObjectId(null, "x")).toBeUndefined();
    expect(optionalObjectId("", "x")).toBeUndefined();
    expect(optionalObjectId(ID, "x")).toBe(ID);
    expect(() => optionalObjectId("bad", "x")).toThrow("x");
  });

  it("toObjectIdList: kiểm tra từng phần tử, chấp nhận chuỗi phân tách bằng dấu phẩy", () => {
    expect(toObjectIdList([ID, ID2], "x")).toEqual([ID, ID2]);
    expect(toObjectIdList(`${ID},${ID2}`, "x")).toEqual([ID, ID2]);
    expect(toObjectIdList(undefined, "x")).toEqual([]);
    expect(() => toObjectIdList([ID, "bad"], "x")).toThrow("x");
    expect(() => toObjectIdList([{ $ne: 1 }], "x")).toThrow("x");
  });

  it("optionalUrgency / requireResolutionCode kiểm tra theo danh sách", () => {
    expect(optionalUrgency(undefined)).toBeUndefined();
    expect(optionalUrgency("high")).toBe("high");
    expect(() => optionalUrgency("bogus")).toThrow();
    expect(requireResolutionCode("solved")).toBe("solved");
    expect(() => requireResolutionCode(undefined)).toThrow();
    expect(() => requireResolutionCode("bogus")).toThrow();
  });

  it("parseListQuery: id lọc sai → 400, rỗng → bỏ qua", () => {
    expect(parseListQuery({ productId: ID, categoryId: "" } as any)).toMatchObject({
      productId: ID,
      categoryId: undefined
    });
    expect(() => parseListQuery({ productId: "bad" } as any)).toThrow();
    expect(() => parseListQuery({ categoryId: "bad" } as any)).toThrow();
    expect(() => parseListQuery({ templateId: "bad" } as any)).toThrow();
    expect(() => parseListQuery({ ownerId: "bad" } as any)).toThrow();
    // ?productId[$ne]=x → object, không được lọt xuống Mongo
    expect(() => parseListQuery({ productId: { $ne: ID } } as any)).toThrow();
  });
});

describe("POST /tickets/:id/close", () => {
  const close = (body: object) => request(app).post(`/tickets/${TICKET}/close`).send(body);

  it("code lạ hoặc thiếu → 400, không đóng ticket", async () => {
    const bogus = await close({ code: "bogus", note: "x" });
    expect(bogus.status).toBe(400);
    const missing = await close({ note: "x" });
    expect(missing.status).toBe(400);
    expect(mockCommands.close).not.toHaveBeenCalled();
  });

  it("code hợp lệ → gọi service; requester_no_response vẫn do domain chặn (không bị controller chặn)", async () => {
    const res = await close({ code: "solved", note: "xong" });
    expect(res.status).toBe(200);
    expect(mockCommands.close).toHaveBeenCalledWith(
      expect.anything(),
      TICKET,
      expect.objectContaining({ code: "solved", note: "xong" }),
      undefined
    );
  });
});

describe("POST /tickets (tạo)", () => {
  const create = (body: object) => request(app).post("/tickets").send(body);

  it("thiếu productId → 400 'Vui lòng chọn sản phẩm'", async () => {
    const res = await create({ title: "x" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Vui lòng chọn sản phẩm");
    expect(mockCommands.create).not.toHaveBeenCalled();
  });

  it.each([
    ["productId", { productId: "not-an-id" }],
    ["categoryId", { categoryId: "not-an-id" }],
    ["templateId", { templateId: "not-an-id" }],
    ["relatedEmployeeId", { relatedEmployeeId: "not-an-id" }],
    ["customer.customerId", { customer: { phone: "0900", customerId: "not-an-id" } }],
    ["relatedTicketIds", { relatedTicketIds: [ID, "not-an-id"] }],
    ["assignment.departmentId", { assignment: { mode: "department", departmentId: "bad" } }],
    ["assignment.memberIds", { assignment: { mode: "members", memberIds: ["bad"] } }],
    ["assignment.ownerId", { assignment: { mode: "members", memberIds: [ID], ownerId: "bad" } }],
    ["urgency", { urgency: "bogus" }]
  ])("%s sai định dạng → 400 và không chạm service", async (_name, override) => {
    const res = await create({ ...validCreate(), ...override });
    expect(res.status).toBe(400);
    expect(res.body.message).not.toMatch(/Cast to ObjectId/);
    expect(mockCommands.create).not.toHaveBeenCalled();
  });

  it("payload hợp lệ của web (giá trị rỗng/null, assignment mode none) vẫn được nhận nguyên hình dạng", async () => {
    const res = await create({
      ...validCreate(),
      templateId: null,
      urgency: "normal",
      customer: { phone: "0900", name: "A", externalId: "", customerId: "", appCode: "" },
      relatedEmployeeId: null,
      assignment: { mode: "members", memberIds: [ID], ownerId: null },
      relatedTicketIds: [ID2]
    });
    expect(res.status).toBe(201);
    const command = mockCommands.create.mock.calls[0][1];
    expect(command).toMatchObject({
      productId: ID,
      categoryId: ID2,
      templateId: null,
      urgency: "normal",
      relatedEmployeeId: null,
      assignment: { mode: "members", memberIds: [ID], ownerId: null },
      relatedTicketIds: [ID2]
    });
    expect(command.customer).toMatchObject({ customerId: "" });
  });
});

describe("PATCH /tickets/:id (sửa)", () => {
  const edit = (body: object) => request(app).patch(`/tickets/${TICKET}`).send(body);

  it("urgency / productId / categoryId sai → 400", async () => {
    expect((await edit({ urgency: "bogus" })).status).toBe(400);
    expect((await edit({ productId: "bad" })).status).toBe(400);
    expect((await edit({ categoryId: "bad" })).status).toBe(400);
    expect(mockCommands.edit).not.toHaveBeenCalled();
  });

  it("giá trị hợp lệ đi qua; trường rỗng bị bỏ thay vì lưu chuỗi rỗng", async () => {
    const res = await edit({
      productId: ID,
      categoryId: "",
      urgency: "high",
      title: "mới",
      note: "n"
    });
    expect(res.status).toBe(200);
    const [, , patch, note] = mockCommands.edit.mock.calls[0];
    expect(patch).toEqual({ productId: ID, urgency: "high", title: "mới" });
    expect(note).toBe("n");
  });
});

describe("assign / collaborators / links / messages", () => {
  it("assign: id sai → 400", async () => {
    const post = (body: object) => request(app).post(`/tickets/${TICKET}/assign`).send(body);
    expect((await post({ mode: "department", departmentId: "bad" })).status).toBe(400);
    expect((await post({ mode: "members", memberIds: ["bad"] })).status).toBe(400);
    expect((await post({ mode: "members", memberIds: [ID], ownerId: "bad" })).status).toBe(400);
    expect(mockCommands.assign).not.toHaveBeenCalled();
    expect((await post({ mode: "members", memberIds: [ID], ownerId: ID })).status).toBe(200);
  });

  it("thêm người phối hợp: thiếu / sai id → 400", async () => {
    const post = (body: object) => request(app).post(`/tickets/${TICKET}/collaborators`).send(body);
    expect((await post({})).status).toBe(400);
    expect((await post({ employeeId: "bad" })).status).toBe(400);
    expect(mockCommands.addCollaborator).not.toHaveBeenCalled();
    expect((await post({ employeeId: ID })).status).toBe(200);
  });

  it("liên kết ticket: id sai → 400", async () => {
    const post = (body: object) => request(app).post(`/tickets/${TICKET}/links`).send(body);
    expect((await post({ relatedTicketId: "bad" })).status).toBe(400);
    expect(mockCommands.linkRelated).not.toHaveBeenCalled();
    expect((await post({ relatedTicketId: ID })).status).toBe(200);
  });

  it("tin nhắn: mentionIds sai → 400", async () => {
    const post = (body: object) => request(app).post(`/tickets/${TICKET}/messages`).send(body);
    expect((await post({ body: "hi", mentionIds: ["bad"] })).status).toBe(400);
    expect(mockCommands.addMessage).not.toHaveBeenCalled();
    expect((await post({ body: "hi", mentionIds: [ID] })).status).toBe(201);
  });
});

describe("GET /tickets (lọc)", () => {
  it("id lọc sai → 400, hợp lệ → gọi service", async () => {
    expect((await request(app).get("/tickets").query({ productId: "bad" })).status).toBe(400);
    expect((await request(app).get("/tickets?productId[$ne]=x")).status).toBe(400);
    expect(mockQueries.list).not.toHaveBeenCalled();
    expect((await request(app).get("/tickets").query({ productId: ID })).status).toBe(200);
    expect(mockQueries.list).toHaveBeenCalledTimes(1);
  });
});
