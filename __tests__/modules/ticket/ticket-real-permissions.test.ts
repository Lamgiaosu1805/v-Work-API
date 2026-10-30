import { execFile } from "child_process";
import path from "path";
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import DepartmentModel from "../../../src/models/DepartmentModel";
import EmployeePermissionProfileModel from "../../../src/models/EmployeePermissionProfileModel";
import PermissionRoleModel from "../../../src/models/PermissionRoleModel";
import PositionModel from "../../../src/models/PositionModel";
import TicketCategoryModel from "../../../src/models/TicketCategoryModel";
import TicketProductModel from "../../../src/models/TicketProductModel";
import TicketTemplateModel from "../../../src/models/TicketTemplateModel";
import TicketModel from "../../../src/models/TicketModel";
import UserDepartmentPositionModel from "../../../src/models/UserDepartmentPositionModel";
import UserInfoModel from "../../../src/models/UserInfoModel";
import { errorHandlerMiddleware } from "../../../src/core/http/error-handler.middleware";

// KIỂM THỬ VỚI PHÂN QUYỀN THẬT: chạy đúng các script seed (permission_catalog, data scope, role...) lên
// Mongo in-memory, gán role cho nhân viên như ngoài thực tế rồi gọi route /tickets với requirePermission
// THẬT (CASL). Chỉ giả `authenticate` (đọc tài khoản từ header) và Redis (mock sẵn trong jest.config).

jest.mock("../../../src/services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue(null)
}));
jest.mock("../../../src/middlewares/authMiddleware", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const accountId = req.headers["x-account"];
    if (!accountId) return res.status(401).json({ message: "Chưa đăng nhập" });
    req.account = { _id: accountId };
    return next();
  }
}));

// eslint-disable-next-line import/first
import ticketRouter from "../../../src/modules/ticket/interface/ticket.routes";

const SCRIPTS = [
  "seedPermissionCatalog.ts",
  "seedPermissionDataScopePolicy.ts",
  "seedPermissionEntityAttributeCatalog.ts",
  "seedPermissionEmployeeBaselineRole.ts",
  "seedPermissionDeptLeadRole.ts",
  "seedPermissionCompanyExecutiveRole.ts",
  "seedPermissionTicketRoles.ts",
  "seedPermissionAdminRole.ts"
];

const runScript = (file: string, uri: string) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      "node",
      ["-r", "ts-node/register/transpile-only", path.join(__dirname, "../../../scripts", file)],
      {
        cwd: path.join(__dirname, "../../.."),
        env: { ...process.env, MONGODB_URI: uri },
        timeout: 180000
      },
      (error, stdout, stderr) =>
        error ? reject(new Error(`${file} lỗi: ${stdout}\n${stderr}`)) : resolve()
    );
  });

let replset: MongoMemoryReplSet;
let app: express.Express;

interface Person {
  accountId: string;
  employeeId: string;
}
const people: Record<string, Person> = {};
let deptIt: any;
let deptSale: any;
let productId: string;
let categoryId: string;
let resetTemplateId: string;
let phoneTemplateId: string;

const as = (key: string, req: request.Test) => req.set("x-account", people[key].accountId);
const get = (key: string, url: string) => as(key, request(app).get(url));
const post = (key: string, url: string) => as(key, request(app).post(url));

async function makePerson(key: string, roleCodes: string[], dept?: any, position?: any) {
  const accountId = new mongoose.Types.ObjectId().toString();
  const user = await UserInfoModel.create({
    full_name: key,
    cccd: `cccd-${key}`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "Hà Nội",
    tinh_trang_hon_nhan: 0,
    id_account: accountId,
    ma_nv: `NV-${key}`,
    employment_type: "fulltime"
  });
  if (dept) {
    await UserDepartmentPositionModel.create({
      user: user._id,
      department: dept._id,
      position: position._id
    });
  }
  const roles = await PermissionRoleModel.find({
    code: { $in: roleCodes },
    isDeleted: false
  }).lean();
  expect(roles.map((role: any) => role.code).sort()).toEqual([...roleCodes].sort());
  await EmployeePermissionProfileModel.create({
    employeeId: user._id,
    roleIds: roles.map((role: any) => role._id)
  });
  people[key] = { accountId, employeeId: String(user._id) };
}

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replset.getUri();
  await mongoose.connect(uri);
  for (const script of SCRIPTS) {
    await runScript(script, uri);
  }

  const dept = await DepartmentModel.create({ department_name: "Khối CN", department_code: "CN" });
  deptIt = await DepartmentModel.create({
    department_name: "IT",
    department_code: "IT",
    parent: dept._id
  });
  deptSale = await DepartmentModel.create({ department_name: "Kinh doanh", department_code: "KD" });
  const position = await PositionModel.create({
    position_name: "Nhân viên",
    position_code: "NV",
    department: dept._id
  });

  const BASE = "EMPLOYEE_BASELINE";
  await makePerson("sale", [BASE], deptSale, position);
  await makePerson("nobody", []);
  await makePerson("it", [BASE, "WORKPLACE_TICKET_STAFF"], deptIt, position);
  await makePerson("itLead", [BASE, "DEPT_LEAD", "WORKPLACE_TICKET_MANAGER"], deptIt, position);
  await makePerson("itMember", [BASE, "WORKPLACE_TICKET_STAFF"], deptIt, position);
  await makePerson("deptLead", [BASE, "DEPT_LEAD"], deptIt, position);
  await makePerson("employee", [BASE], deptIt, position);
  await makePerson("saleMate", [BASE], deptSale, position);
  await makePerson("accountant", [BASE, "WORKPLACE_TICKET_HANDLER"], deptSale, position);
  await makePerson("exec", [BASE, "COMPANY_EXECUTIVE"], dept, position);
  await makePerson("admin", ["PERMISSION_ADMIN"], dept, position);

  const product = await TicketProductModel.create({ code: "tikluy_app", name: "TIKLUY APP" });
  const category = await TicketCategoryModel.create({ code: "account", name: "Tài khoản" });
  const reset = await TicketTemplateModel.create({
    code: "reset_device",
    name: "Reset thiết bị",
    category_id: category._id,
    default_urgency: "urgent",
    required_documents: [{ kind: "cccd_images", label: "CCCD", required: true, sensitive: true }]
  });
  const phone = await TicketTemplateModel.create({
    code: "change_phone",
    name: "Đổi SĐT",
    category_id: category._id,
    requires_approval: true
  });
  productId = String(product._id);
  categoryId = String(category._id);
  resetTemplateId = String(reset._id);
  phoneTemplateId = String(phone._id);

  app = express();
  app.use(express.json());
  app.use("/tickets", ticketRouter);
  app.use(errorHandlerMiddleware);
}, 600000);

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await TicketModel.deleteMany({});
});

const create = async (key: string, payload: Record<string, unknown> = {}) =>
  (
    await as(key, request(app).post("/tickets"))
      .field(
        "payload",
        JSON.stringify({ title: "Khách không nhận OTP", productId, categoryId, ...payload })
      )
      .expect(201)
  ).body.data as { id: string; status: string };

describe("quyền thật từ các role đã seed", () => {
  it("không có role nào → không vào được ticket (403)", async () => {
    await get("nobody", "/tickets").expect(403);
    await get("nobody", "/tickets/meta").expect(403);
  });

  it("nhân viên (EMPLOYEE_BASELINE): tạo, xem được ticket nhưng không nhận / xử lý được; không vào được cấu hình", async () => {
    const ticket = await create("sale");
    await get("sale", "/tickets?tab=all").expect(200);
    await post("sale", `/tickets/${ticket.id}/claim`).expect(403);
    await post("itMember", `/tickets/${ticket.id}/claim`).expect(200);
    await get("sale", "/tickets/config/products").expect(403);
    await get("sale", "/tickets/config/settings").expect(403);
  });

  it("người xử lý ở đơn vị khác (WORKPLACE_TICKET_HANDLER): nhận được ticket nhưng không giao phòng ban, không xem ticket hạn chế / file nhạy cảm", async () => {
    const ticket = await create("sale");
    await post("accountant", `/tickets/${ticket.id}/claim`).expect(200);

    const me = (await get("accountant", "/tickets/meta").expect(200)).body.data.me;
    expect(me).toMatchObject({
      canAssignDepartment: false,
      canAssignMember: false,
      canManage: false,
      canViewRestricted: false,
      canViewSensitive: false
    });
    await get("accountant", "/tickets/config/products").expect(403);
  });

  it("meta phản ánh đúng quyền từng vai trò", async () => {
    const me = async (key: string) => (await get(key, "/tickets/meta").expect(200)).body.data.me;
    expect(await me("sale")).toMatchObject({
      canAssignDepartment: false,
      canAssignMember: false,
      canManage: false,
      canViewRestricted: false,
      canViewSensitive: false,
      canViewAll: false
    });
    expect(await me("deptLead")).toMatchObject({ canAssignMember: true, canViewAll: false });
    expect(await me("accountant")).toMatchObject({ canViewAll: true });
    expect(await me("it")).toMatchObject({
      canViewAll: true,
      canAssignDepartment: true,
      canViewRestricted: true,
      canViewSensitive: true,
      canManage: false
    });
    expect(await me("itLead")).toMatchObject({
      canAssignMember: true,
      canManage: true,
      canViewSensitive: true
    });
    expect(await me("exec")).toMatchObject({
      canAssignDepartment: true,
      canAssignMember: true,
      canManage: true,
      canViewRestricted: true
    });
  });

  it("phạm vi xem ticket thường: nhân viên chỉ thấy của mình và người cùng phòng; người xử lý thấy hết", async () => {
    const ticket = await create("sale"); // phòng Kinh doanh

    // người cùng phòng thấy; người phòng khác (IT) không thấy ở danh sách lẫn chi tiết
    await get("saleMate", `/tickets/${ticket.id}`).expect(200);
    await get("employee", `/tickets/${ticket.id}`).expect(404);
    await get("deptLead", `/tickets/${ticket.id}`).expect(404);
    const listed = async (key: string) =>
      (await get(key, "/tickets?tab=all").expect(200)).body.data.map((item: any) => item.id);
    expect(await listed("saleMate")).toContain(ticket.id);
    expect(await listed("employee")).not.toContain(ticket.id);
    expect(await listed("deptLead")).not.toContain(ticket.id);

    // người xử lý (kể cả đơn vị khác IT) và quản lý thấy hết
    await get("accountant", `/tickets/${ticket.id}`).expect(200);
    await get("it", `/tickets/${ticket.id}`).expect(200);
    await get("exec", `/tickets/${ticket.id}`).expect(200);
    expect(await listed("accountant")).toContain(ticket.id);

    // giao cho phòng IT thì thành viên phòng IT thấy được dù không cùng phòng người tạo
    await post("exec", `/tickets/${ticket.id}/assign`)
      .send({ mode: "department", departmentId: String(deptIt._id) })
      .expect(200);
    await get("employee", `/tickets/${ticket.id}`).expect(200);

    // ticket của chính mình luôn thấy; ticket cùng phòng nhưng người khác tạo ở phòng khác thì không
    const mine = await create("employee");
    await get("employee", `/tickets/${mine.id}`).expect(200);
    await get("saleMate", `/tickets/${mine.id}`).expect(404);
  });

  it("ticket hạn chế (cần tờ trình): IT xem được, nhân viên thường không thấy; file CCCD chỉ IT mở được", async () => {
    const restricted = (
      await as("sale", request(app).post("/tickets"))
        .field(
          "payload",
          JSON.stringify({
            title: "Đổi SĐT",
            productId,
            templateId: phoneTemplateId,
            fileKinds: ["approval_document"]
          })
        )
        .attach("files", Buffer.from("totrinh"), "totrinh.png")
        .expect(201)
    ).body.data;

    await get("employee", `/tickets/${restricted.id}`).expect(404);
    const asIt = await get("it", `/tickets/${restricted.id}`).expect(200);
    expect(asIt.body.data.attachments[0].canOpen).toBe(true);

    const normal = (
      await as("sale", request(app).post("/tickets"))
        .field(
          "payload",
          JSON.stringify({
            title: "Reset",
            productId,
            templateId: resetTemplateId,
            fileKinds: ["cccd_images"]
          })
        )
        .attach("files", Buffer.from("cccd"), "cccd.png")
        .expect(201)
    ).body.data;
    const forMember = await get("saleMate", `/tickets/${normal.id}`).expect(200);
    expect(forMember.body.data.attachments[0]).toMatchObject({ canOpen: false, name: null });
    const forIt = await get("it", `/tickets/${normal.id}`).expect(200);
    expect(forIt.body.data.attachments[0].canOpen).toBe(true);
  });

  it("giao việc: ban lãnh đạo giao phòng ban; trưởng bộ phận chỉ giao người trong phòng mình; nhân viên thường không giao được", async () => {
    const ticket = await create("sale");
    const body = (mode: string, extra: Record<string, unknown>) => ({ mode, ...extra });

    await post("sale", `/tickets/${ticket.id}/assign`)
      .send(body("members", { memberIds: [people.itMember.employeeId] }))
      .expect(403);
    await post("exec", `/tickets/${ticket.id}/assign`)
      .send(body("department", { departmentId: String(deptIt._id) }))
      .expect(200);
    await post("deptLead", `/tickets/${ticket.id}/assign`)
      .send(body("department", { departmentId: String(deptIt._id) }))
      .expect(403); // trưởng bộ phận (chỉ DEPT_LEAD) không giao cả phòng
    await post("it", `/tickets/${ticket.id}/assign`)
      .send(body("department", { departmentId: String(deptSale._id) }))
      .expect(200); // nhân viên hỗ trợ (IT) chuyển việc nghiệp vụ về phòng chủ trì

    // Trưởng bộ phận chỉ thấy ticket được giao cho phòng mình (không thấy ticket chưa giao của phòng khác)
    const other = await create("sale");
    await post("deptLead", `/tickets/${other.id}/assign`)
      .send(body("members", { memberIds: [people.itMember.employeeId] }))
      .expect(404);
    await post("exec", `/tickets/${other.id}/assign`)
      .send(body("department", { departmentId: String(deptIt._id) }))
      .expect(200);
    await post("deptLead", `/tickets/${other.id}/assign`)
      .send(body("members", { memberIds: [people.sale.employeeId] })) // người phòng Kinh doanh
      .expect(403);
    await post("deptLead", `/tickets/${other.id}/assign`)
      .send(body("members", { memberIds: [people.itMember.employeeId, people.it.employeeId] }))
      .expect(200);
    // người ngoài danh sách được giao thì không nhận được
    await post("exec", `/tickets/${other.id}/claim`).expect(403);
    await post("itMember", `/tickets/${other.id}/claim`).expect(200);
  });

  it("ban lãnh đạo (manage, không có handle) đóng hộ được nhưng không nhận / trả lại được", async () => {
    const ticket = await create("sale");
    await post("exec", `/tickets/${ticket.id}/claim`).expect(403);
    await post("exec", `/tickets/${ticket.id}/release`).send({ note: "x" }).expect(403);
    await post("exec", `/tickets/${ticket.id}/close`)
      .send({ code: "not_a_bug", note: "Hệ thống đúng nghiệp vụ" })
      .expect(200);
    // nhân viên thường (không handle, không manage) vẫn bị chặn ở route
    const other = await create("sale");
    await post("sale", `/tickets/${other.id}/close`).send({ code: "solved" }).expect(403);
  });

  it("giao việc cho người chưa có ticket.handle bị từ chối ngay (400), người có quyền thì giao được", async () => {
    const ticket = await create("sale");
    await post("exec", `/tickets/${ticket.id}/assign`)
      .send({ mode: "department", departmentId: String(deptIt._id) })
      .expect(200);

    // trưởng bộ phận giao cho nhân viên phòng mình nhưng người đó chỉ có role nhân viên
    await post("deptLead", `/tickets/${ticket.id}/assign`)
      .send({ mode: "members", memberIds: [people.employee.employeeId] })
      .expect(400);
    await post("deptLead", `/tickets/${ticket.id}/assign`)
      .send({ mode: "members", memberIds: [people.itMember.employeeId] })
      .expect(200);

    // ô chọn người giao chỉ gợi ý người có quyền xử lý
    const names = (
      await get("exec", "/tickets/directory/employees?assignable=1&q=").expect(200)
    ).body.data.map((item: any) => item.fullName);
    expect(names).toContain("itMember");
    expect(names).not.toContain("employee");
  });

  it("tìm nhân viên không để giao việc (nhân sự liên quan, @nhắc): nhân viên thường tìm được mọi người", async () => {
    const found = async (key: string, q: string) =>
      (await get(key, `/tickets/directory/employees?q=${q}`).expect(200)).body.data.map(
        (item: any) => item.fullName
      );
    // người không có ticket.handle vẫn tìm thấy được (chỉ ô chọn người GIAO VIỆC mới giới hạn theo quyền xử lý)
    expect(await found("sale", "employee")).toContain("employee");
    expect(await found("employee", "itMember")).toContain("itMember");
    expect(await found("sale", "NV-employee")).toContain("employee");
  });

  it("giao cho phòng ban: người phòng con (IT thuộc Khối CN) nhận được, người phòng khác không", async () => {
    const ticket = await create("exec", {
      assignment: { mode: "department", departmentId: String(deptIt._id) }
    });
    await post("sale", `/tickets/${ticket.id}/claim`).expect(403);
    await post("itMember", `/tickets/${ticket.id}/claim`).expect(200);
  });

  it("cấu hình: WORKPLACE_TICKET_MANAGER và PERMISSION_ADMIN vào được; nhân viên hỗ trợ và nhân viên thường thì không", async () => {
    await get("itLead", "/tickets/config/products").expect(200);
    await get("admin", "/tickets/config/products").expect(200);
    await get("it", "/tickets/config/products").expect(403);
    await get("sale", "/tickets/config/products").expect(403);
  });

  it("quản trị (PERMISSION_ADMIN) xem/xử lý được mọi ticket, kể cả ticket hạn chế", async () => {
    const restricted = (
      await as("sale", request(app).post("/tickets"))
        .field(
          "payload",
          JSON.stringify({
            title: "Đổi SĐT",
            productId,
            templateId: phoneTemplateId,
            fileKinds: ["approval_document"]
          })
        )
        .attach("files", Buffer.from("x"), "tt.png")
        .expect(201)
    ).body.data;
    const detail = await get("admin", `/tickets/${restricted.id}`).expect(200);
    expect(detail.body.data.accessLevel).toBe("full");
  });
});
