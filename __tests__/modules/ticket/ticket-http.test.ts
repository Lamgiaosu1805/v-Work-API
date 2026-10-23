import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import TicketModel from "../../../src/models/TicketModel";
import TicketActivityModel from "../../../src/models/TicketActivityModel";
import TicketAttachmentModel from "../../../src/models/TicketAttachmentModel";
import TicketCategoryModel from "../../../src/models/TicketCategoryModel";
import TicketCounterModel from "../../../src/models/TicketCounterModel";
import TicketMessageModel from "../../../src/models/TicketMessageModel";
import TicketProductModel from "../../../src/models/TicketProductModel";
import TicketSettingModel from "../../../src/models/TicketSettingModel";
import TicketTemplateModel from "../../../src/models/TicketTemplateModel";
import UserInfoModel from "../../../src/models/UserInfoModel";
import { errorHandlerMiddleware } from "../../../src/core/http/error-handler.middleware";

// Thư mục lưu file riêng cho test — phải đặt TRƯỚC khi nạp middleware upload.
const TICKET_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-http-"));
process.env.TICKET_DIR_DEV = TICKET_DIR;

jest.mock("../../../src/services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue(null)
}));

// Xác thực + phân quyền giả: tài khoản và danh sách quyền lấy từ header, để test tập trung vào route,
// multipart, kiểm tra quyền theo từng ticket và tải file.
jest.mock("../../../src/middlewares/authMiddleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const accountId = req.headers["x-account"];
    if (!accountId) return res.status(401).json({ message: "Chưa đăng nhập" });
    req.account = { _id: accountId };
    return next();
  }
}));
jest.mock("../../../src/core/authorization/require-permission.middleware", () => ({
  requirePermission: (action: string) => (req: any, res: any, next: any) => {
    const permissions: string[] = JSON.parse(req.headers["x-perms"] ?? "[]");
    if (!permissions.includes(action)) {
      return res.status(403).json({ message: "Bạn không có quyền thực hiện thao tác này" });
    }
    req.permissionAbility = { can: (code: string) => permissions.includes(code) };
    return next();
  }
}));

// eslint-disable-next-line import/first
import ticketRouter from "../../../src/modules/ticket/interface/ticket.routes";

const ALL_MODELS: Array<mongoose.Model<any>> = [
  TicketModel,
  TicketActivityModel,
  TicketAttachmentModel,
  TicketMessageModel,
  TicketCounterModel,
  TicketProductModel,
  TicketCategoryModel,
  TicketTemplateModel,
  TicketSettingModel,
  UserInfoModel
];

const EVERYONE = ["ticket.view", "ticket.create", "ticket.handle"];
const IT = [...EVERYONE, "ticket.view_restricted", "ticket.view_sensitive"];
const ADMIN = [...IT, "ticket.config", "ticket.manage"];

interface Person {
  accountId: string;
  employeeId: string;
  perms: string[];
}

let replset: MongoMemoryReplSet;
let app: express.Express;
let requester: Person;
let itPerson: Person;
let stranger: Person;
let admin: Person;
let productId: string;
let categoryId: string;
let resetTemplateId: string;

async function makePerson(name: string, perms: string[]): Promise<Person> {
  const accountId = new mongoose.Types.ObjectId().toString();
  const user = await UserInfoModel.create({
    full_name: name,
    cccd: `cccd-${name}`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: accountId,
    ma_nv: `NV-${name}-${Math.random()}`,
    employment_type: "fulltime"
  });
  return { accountId, employeeId: String(user._id), perms };
}

const as = (person: Person, req: request.Test) =>
  req.set("x-account", person.accountId).set("x-perms", JSON.stringify(person.perms));

const get = (person: Person, url: string) => as(person, request(app).get(url));
const post = (person: Person, url: string) => as(person, request(app).post(url));

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  await Promise.all(ALL_MODELS.map((model) => model.init()));

  app = express();
  app.use(express.json());
  app.use("/tickets", ticketRouter);
  app.use(errorHandlerMiddleware);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
  fs.rmSync(TICKET_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await Promise.all(ALL_MODELS.map((model) => model.deleteMany({})));
  fs.readdirSync(TICKET_DIR).forEach((name) => fs.rmSync(path.join(TICKET_DIR, name)));

  [requester, itPerson, stranger, admin] = await Promise.all([
    makePerson("requester", EVERYONE),
    makePerson("it", IT),
    makePerson("stranger", EVERYONE),
    makePerson("admin", ADMIN)
  ]);
  const product = await TicketProductModel.create({ code: "tikluy_app", name: "TIKLUY APP" });
  const category = await TicketCategoryModel.create({ code: "account", name: "Tài khoản" });
  const template = await TicketTemplateModel.create({
    code: "reset_device",
    name: "Reset thiết bị",
    category_id: category._id,
    default_urgency: "urgent",
    required_documents: [
      { kind: "cccd_images", label: "CCCD 2 mặt", required: true, sensitive: true }
    ]
  });
  productId = String(product._id);
  categoryId = String(category._id);
  resetTemplateId = String(template._id);
});

async function createTicket(overrides: Record<string, unknown> = {}) {
  const res = await as(requester, request(app).post("/tickets"))
    .field(
      "payload",
      JSON.stringify({
        title: "Khách không nhận OTP",
        productId,
        categoryId,
        customer: { phone: "0912345678", name: "Khách A" },
        ...overrides
      })
    )
    .expect(201);
  return res.body.data as { id: string; code: string; status: string };
}

describe("xác thực và phân quyền ở route", () => {
  it("chưa đăng nhập → 401; thiếu quyền → 403", async () => {
    await request(app).get("/tickets").expect(401);
    await as({ ...requester, perms: [] }, request(app).get("/tickets")).expect(403);
    await as(requester, request(app).get("/tickets/config/products")).expect(403);
  });
});

describe("tạo và đọc ticket", () => {
  it("tạo ticket multipart kèm file; danh sách / chi tiết trả đúng dữ liệu", async () => {
    const created = await createTicket();
    expect(created.code).toMatch(/^TK-\d{4}-0001$/);
    expect(created.status).toBe("open");

    const list = await get(requester, "/tickets?tab=created").expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ id: created.id, title: "Khách không nhận OTP" });

    const detail = await get(requester, `/tickets/${created.id}`).expect(200);
    expect(detail.body.data.accessLevel).toBe("full");
    expect(detail.body.data.capabilities).toMatchObject({ cancel: true, edit: true, claim: true });
  });

  it("tạo ticket theo mẫu bắt buộc CCCD: thiếu file → 400; có file → lưu đĩa riêng, đánh dấu nhạy cảm", async () => {
    await as(requester, request(app).post("/tickets"))
      .field("payload", JSON.stringify({ title: "Reset", productId, templateId: resetTemplateId }))
      .expect(400);

    const res = await as(requester, request(app).post("/tickets"))
      .field(
        "payload",
        JSON.stringify({
          title: "Reset thiết bị",
          productId,
          templateId: resetTemplateId,
          fileKinds: ["cccd_images"]
        })
      )
      .attach("files", Buffer.from("fake-image"), "cccd.png")
      .expect(201);

    expect(fs.readdirSync(TICKET_DIR)).toHaveLength(1);
    const attachment: any = await TicketAttachmentModel.findOne({
      ticket_id: res.body.data.id
    }).lean();
    expect(attachment).toMatchObject({
      kind: "cccd_images",
      sensitive: true,
      original_name: "cccd.png"
    });
    expect(attachment.stored_name).not.toContain("cccd");
  });

  it("tên file tiếng Việt có dấu được lưu đúng và tải về đúng tên; tên có đường dẫn bị cắt", async () => {
    const created = await as(requester, request(app).post("/tickets"))
      .field(
        "payload",
        JSON.stringify({ title: "Tờ trình", productId, categoryId, fileKinds: ["other", "other"] })
      )
      .attach("files", Buffer.from("a"), "Giấy tờ CCCD – Nguyễn Văn Á.png")
      .attach("files", Buffer.from("b"), "../../etc/passwd.png")
      .expect(201);

    const names = (
      await TicketAttachmentModel.find({ ticket_id: created.body.data.id })
        .sort({ createdAt: 1 })
        .lean()
    ).map((item: any) => item.original_name);
    expect(names).toEqual(["Giấy tờ CCCD – Nguyễn Văn Á.png", "passwd.png"]);

    const detail = await get(requester, `/tickets/${created.body.data.id}`).expect(200);
    const file = detail.body.data.attachments[0];
    const download = await get(
      requester,
      `/tickets/${created.body.data.id}/attachments/${file.id}/download`
    ).expect(200);
    expect(decodeURIComponent(download.headers["content-disposition"])).toContain(
      "Giấy tờ CCCD – Nguyễn Văn Á.png"
    );
  });

  it("file không được phép (html) bị từ chối ở middleware upload", async () => {
    const res = await as(requester, request(app).post("/tickets"))
      .field("payload", JSON.stringify({ title: "x", productId, categoryId }))
      .attach("files", Buffer.from("<script>alert(1)</script>"), "evil.html");
    expect(res.status).toBe(400);
    expect(fs.readdirSync(TICKET_DIR)).toHaveLength(0);
  });

  it("tạo lỗi sau khi upload thì file đã ghi đĩa bị xoá (không để file mồ côi)", async () => {
    await as(requester, request(app).post("/tickets"))
      .field(
        "payload",
        JSON.stringify({
          title: "x",
          productId: new mongoose.Types.ObjectId().toString(),
          categoryId
        })
      )
      .attach("files", Buffer.from("png"), "a.png")
      .expect(400);
    expect(fs.readdirSync(TICKET_DIR)).toHaveLength(0);
  });
});

describe("luồng nhận → xử lý → xác nhận qua HTTP", () => {
  it("IT nhận, báo xong; người tạo xác nhận; người khác không nhận được ticket đã có chủ trì", async () => {
    const created = await createTicket();

    await post(itPerson, `/tickets/${created.id}/claim`).expect(200);
    const second = await post(stranger, `/tickets/${created.id}/claim`);
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/đã (nhận|có người nhận)/);

    await post(itPerson, `/tickets/${created.id}/resolve`)
      .send({ note: "Đã reset OTP", actionTaken: "Reset trên CMS" })
      .expect(200);
    await post(stranger, `/tickets/${created.id}/confirm`).expect(403); // thiếu ticket.create? có — nhưng không phải người tạo
    await post(requester, `/tickets/${created.id}/confirm`).expect(200);

    const detail = await get(itPerson, `/tickets/${created.id}`).expect(200);
    expect(detail.body.data.status).toBe("closed");
    expect(detail.body.data.activities.map((item: any) => item.action)).toEqual([
      "created",
      "claimed",
      "resolved",
      "confirmed"
    ]);
  });

  it("thiếu quyền ticket.handle thì không nhận được dù là nhân viên", async () => {
    const created = await createTicket();
    await post(
      { ...stranger, perms: ["ticket.view", "ticket.create"] },
      `/tickets/${created.id}/claim`
    ).expect(403);
  });

  it("id không hợp lệ → 404, không lỗi 500", async () => {
    await get(requester, "/tickets/khong-phai-objectid").expect(404);
    await post(itPerson, "/tickets/khong-phai-objectid/claim").expect(404);
  });
});

describe("trao đổi và tải file nhạy cảm", () => {
  it("gửi tin nhắn kèm file; người có quyền tải được file, người ngoài không tải được file nhạy cảm", async () => {
    const created = await as(requester, request(app).post("/tickets"))
      .field(
        "payload",
        JSON.stringify({
          title: "Reset thiết bị",
          productId,
          templateId: resetTemplateId,
          fileKinds: ["cccd_images"]
        })
      )
      .attach("files", Buffer.from("noi-dung-cccd"), "cccd.png")
      .expect(201);
    const ticketId = created.body.data.id;
    await post(itPerson, `/tickets/${ticketId}/claim`).expect(200);

    const message = await as(itPerson, request(app).post(`/tickets/${ticketId}/messages`))
      .field("payload", JSON.stringify({ body: "Em đang kiểm tra", fileKinds: ["screenshot"] }))
      .attach("files", Buffer.from("anh-loi"), "loi.png")
      .expect(201);
    expect(message.body.data.messageId).toBeTruthy();

    const detail = await get(itPerson, `/tickets/${ticketId}`).expect(200);
    const cccd = detail.body.data.attachments.find((item: any) => item.kind === "cccd_images");
    const screenshot = detail.body.data.attachments.find((item: any) => item.kind === "screenshot");
    expect(cccd.canOpen).toBe(true);

    const download = await get(
      itPerson,
      `/tickets/${ticketId}/attachments/${cccd.id}/download`
    ).expect(200);
    expect(download.headers["content-type"]).toMatch(/image\/png/);
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.headers["cache-control"]).toMatch(/no-store/);

    // Người ngoài: ticket thường nên xem được, nhưng file CCCD chỉ là dòng thông tin
    const strangerView = await get(stranger, `/tickets/${ticketId}`).expect(200);
    const redacted = strangerView.body.data.attachments.find(
      (item: any) => item.kind === "cccd_images"
    );
    expect(redacted).toMatchObject({ canOpen: false, name: null });
    await get(stranger, `/tickets/${ticketId}/attachments/${cccd.id}/download`).expect(404);
    // File không nhạy cảm thì ai xem được ticket cũng tải được
    await get(stranger, `/tickets/${ticketId}/attachments/${screenshot.id}/download`).expect(200);
  });
});

describe("cấu hình ticket (quyền ticket.config)", () => {
  it("admin tạo / sửa / xoá sản phẩm; mã trùng → 409; form tạo ticket đọc được qua /meta", async () => {
    const created = await post(admin, "/tickets/config/products")
      .send({ code: "vnfite_app", name: "VNFITE APP", group: "VNFITE", appCode: "vnfite" })
      .expect(201);
    await post(admin, "/tickets/config/products")
      .send({ code: "vnfite_app", name: "Trùng mã" })
      .expect(409);

    await as(admin, request(app).patch(`/tickets/config/products/${created.body.data.id}`))
      .send({ name: "VNFITE APP (đã sửa)" })
      .expect(200);

    const meta = await get(requester, "/tickets/meta").expect(200);
    expect(meta.body.data.products.map((item: any) => item.name)).toContain("VNFITE APP (đã sửa)");
    expect(meta.body.data.me).toMatchObject({ employeeId: requester.employeeId, canManage: false });

    await as(admin, request(app).delete(`/tickets/config/products/${created.body.data.id}`)).expect(
      200
    );
    const after = await get(requester, "/tickets/meta").expect(200);
    expect(after.body.data.products.map((item: any) => item.code)).not.toContain("vnfite_app");
  });

  it("cài đặt chung: đọc mặc định, lưu và đọc lại; giá trị không hợp lệ bị từ chối", async () => {
    const defaults = await get(admin, "/tickets/config/settings").expect(200);
    expect(defaults.body.data.policy.autoCloseResolvedDays).toBe(3);

    await as(admin, request(app).patch("/tickets/config/settings"))
      .send({ reopenDays: 0 })
      .expect(400);
    await as(admin, request(app).patch("/tickets/config/settings"))
      .send({ autoCloseResolvedDays: 5, workDays: [1, 2, 3, 4, 5] })
      .expect(200);

    const saved = await get(admin, "/tickets/config/settings").expect(200);
    expect(saved.body.data.policy.autoCloseResolvedDays).toBe(5);
    expect(saved.body.data.calendar.workDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("danh mục loại yêu cầu trả kèm tên người phụ trách", async () => {
    await as(admin, request(app).post("/tickets/config/categories"))
      .send({ code: "incident", name: "Sự cố", handlerIds: [itPerson.employeeId] })
      .expect(201);
    const list = await get(admin, "/tickets/config/categories").expect(200);
    const incident = list.body.data.find((item: any) => item.code === "incident");
    expect(incident.handlers.map((person: any) => person.fullName)).toEqual(["it"]);
  });
});

describe("danh bạ nhân viên", () => {
  it("tìm nhân viên theo tên chỉ trả id, tên, phòng ban (không lộ CCCD...)", async () => {
    const res = await get(requester, "/tickets/directory/employees?q=it").expect(200);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({ id: itPerson.employeeId, fullName: "it" })
    );
    expect(res.body.data[0].cccd).toBeUndefined();
    expect(res.body.data[0].phone_number).toBeUndefined();
  });
});
