/* eslint-disable class-methods-use-this, max-classes-per-file */
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import TicketActivityModel from "../../../src/models/TicketActivityModel";
import TicketAttachmentModel from "../../../src/models/TicketAttachmentModel";
import TicketCategoryModel from "../../../src/models/TicketCategoryModel";
import TicketCounterModel from "../../../src/models/TicketCounterModel";
import TicketMessageModel from "../../../src/models/TicketMessageModel";
import TicketModel from "../../../src/models/TicketModel";
import TicketProductModel from "../../../src/models/TicketProductModel";
import TicketSettingModel from "../../../src/models/TicketSettingModel";
import TicketTemplateModel from "../../../src/models/TicketTemplateModel";
import {
  TicketCommandService,
  createDefaultTicketDeps
} from "../../../src/modules/ticket/application/ticket-commands.service";
import { TicketQueryService } from "../../../src/modules/ticket/application/ticket-queries.service";
import { TicketSweepService } from "../../../src/modules/ticket/application/ticket-sweep.service";
import {
  DepartmentSummary,
  EmployeeSummary,
  TicketDirectory,
  TicketNotification,
  TicketNotifier
} from "../../../src/modules/ticket/application/ports";
import { MongooseTicketConfigReader } from "../../../src/modules/ticket/infrastructure/ticket-config.repository";
import {
  TicketAlreadyClaimedError,
  TicketForbiddenError,
  TicketNotFoundError,
  TicketVersionConflictError
} from "../../../src/modules/ticket/domain/ticket.errors";
import { TicketActor } from "../../../src/modules/ticket/domain/types";
import { ArgumentInvalidException } from "../../../src/core/exceptions/exceptions";

// Firebase/FCM không có trong môi trường test; thông báo thật đã được thay bằng notifier giả bên dưới,
// nhưng domain-event handler mặc định vẫn `require` service này khi nạp.
jest.mock("../../../src/services/notificationService", () => ({
  createNotification: jest.fn().mockResolvedValue(null)
}));

// ---- dữ liệu tổ chức giả (thay MongooseTicketDirectory) ---------------------------------------

const id = () => new mongoose.Types.ObjectId().toString();

const DEPT_IT = id();
const DEPT_CSKH = id();
const DEPT_KHOI = id(); // phòng cha của IT

const REQUESTER = id();
const IT_A = id();
const IT_B = id();
const IT_C = id();
const HEAD_IT = id(); // trưởng bộ phận IT
const BOSS = id(); // ban lãnh đạo
const STRANGER = id();

const EMPLOYEES: Record<string, { name: string; departments: string[] }> = {
  [REQUESTER]: { name: "Người tạo", departments: [DEPT_CSKH] },
  [IT_A]: { name: "IT A", departments: [DEPT_IT] },
  [IT_B]: { name: "IT B", departments: [DEPT_IT] },
  [IT_C]: { name: "IT C", departments: [DEPT_CSKH] },
  [HEAD_IT]: { name: "Trưởng IT", departments: [DEPT_IT] },
  [BOSS]: { name: "Sếp", departments: [DEPT_KHOI] },
  [STRANGER]: { name: "Người ngoài", departments: [DEPT_CSKH] }
};

class FakeDirectory implements TicketDirectory {
  async resolveEmployeeId(accountId: string) {
    return accountId;
  }

  async getDepartmentIdsWithAncestors(employeeId: string) {
    const own = EMPLOYEES[employeeId]?.departments ?? [];
    // IT nằm dưới Khối: người ở IT thuộc cả Khối
    return own.includes(DEPT_IT) ? [...own, DEPT_KHOI] : own;
  }

  async getOwnDepartmentTreeEmployeeIds(employeeId: string) {
    return employeeId === HEAD_IT ? [IT_A, IT_B, HEAD_IT] : [];
  }

  async getEmployees(ids: string[]): Promise<EmployeeSummary[]> {
    return ids
      .filter((employeeId) => EMPLOYEES[employeeId])
      .map((employeeId) => ({
        id: employeeId,
        fullName: EMPLOYEES[employeeId].name,
        accountId: employeeId,
        departmentNames: []
      }));
  }

  async getDepartments(ids: string[]): Promise<DepartmentSummary[]> {
    return ids
      .filter((deptId) => [DEPT_IT, DEPT_CSKH, DEPT_KHOI].includes(deptId))
      .map((deptId) => ({ id: deptId, name: `Phòng ${deptId.slice(-4)}`, managerId: HEAD_IT }));
  }

  async searchEmployees(): Promise<EmployeeSummary[]> {
    return [];
  }

  async listDepartments(): Promise<DepartmentSummary[]> {
    return [];
  }
}

class RecordingNotifier implements TicketNotifier {
  sent: TicketNotification[] = [];

  async notify(notification: TicketNotification) {
    this.sent.push(notification);
  }
}

// ---- thiết lập ---------------------------------------------------------------------------------

let replset: MongoMemoryReplSet;
let now: Date;
let notifier: RecordingNotifier;
let commands: TicketCommandService;
let queries: TicketQueryService;
let ids: { product: string; category: string; templateReset: string; templatePhone: string };

const directory = new FakeDirectory();

const ALL_MODELS: Array<mongoose.Model<any>> = [
  TicketModel,
  TicketActivityModel,
  TicketAttachmentModel,
  TicketMessageModel,
  TicketCounterModel,
  TicketProductModel,
  TicketCategoryModel,
  TicketTemplateModel,
  TicketSettingModel
];

function actor(employeeId: string, overrides: Partial<TicketActor> = {}): TicketActor {
  return {
    employeeId,
    departmentIds: EMPLOYEES[employeeId]?.departments ?? [],
    canAssignDepartment: false,
    canAssignMember: false,
    canManage: false,
    canViewRestricted: false,
    canViewSensitive: false,
    ...overrides
  };
}

const requester = () => actor(REQUESTER);
// IT có role "TICKET_IT": xem được ticket hạn chế và file nhạy cảm (xem scripts/seedPermissionTicketRoles.ts)
const itRole = { canViewRestricted: true, canViewSensitive: true };
const itA = () => actor(IT_A, { departmentIds: [DEPT_IT, DEPT_KHOI], ...itRole });
const itB = () => actor(IT_B, { departmentIds: [DEPT_IT, DEPT_KHOI], ...itRole });
const headIt = () => actor(HEAD_IT, { canAssignMember: true, departmentIds: [DEPT_IT, DEPT_KHOI] });
const boss = () =>
  actor(BOSS, {
    canAssignDepartment: true,
    canAssignMember: true,
    canManage: true,
    canViewRestricted: true,
    canViewSensitive: true
  });
const stranger = () => actor(STRANGER);

const T0 = new Date("2026-10-26T09:00:00+07:00"); // thứ Hai
const hoursLater = (hours: number) => new Date(T0.getTime() + hours * 60 * 60 * 1000);

function buildServices(clock: () => Date) {
  notifier = new RecordingNotifier();
  const deps = { ...createDefaultTicketDeps(), directory, notifier, now: clock };
  commands = new TicketCommandService(deps);
  queries = new TicketQueryService({
    directory,
    config: new MongooseTicketConfigReader(),
    now: clock
  });
}

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  // Chờ Mongoose dựng xong index nền trước khi chạy transaction thật (xem attendanceCheckOut.test.ts)
  await Promise.all(ALL_MODELS.map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await Promise.all(ALL_MODELS.map((model) => model.deleteMany({})));

  const product = await TicketProductModel.create({
    code: "tikluy_app",
    name: "TIKLUY APP",
    group: "TIKLUY",
    app_code: "tikluy"
  });
  const category = await TicketCategoryModel.create({
    code: "customer_account",
    name: "Tài khoản"
  });
  const templateReset = await TicketTemplateModel.create({
    code: "reset_device",
    name: "Reset thiết bị",
    category_id: category._id,
    default_urgency: "urgent",
    required_documents: [
      { kind: "cccd_images", label: "CCCD 2 mặt", required: true, sensitive: true }
    ]
  });
  const templatePhone = await TicketTemplateModel.create({
    code: "change_phone",
    name: "Đổi số điện thoại",
    category_id: category._id,
    requires_approval: true,
    fields: [{ key: "new_phone", label: "SĐT mới", type: "phone", required: true }],
    required_documents: [
      { kind: "approval_document", label: "Tờ trình", required: true, sensitive: true }
    ]
  });
  ids = {
    product: String(product._id),
    category: String(category._id),
    templateReset: String(templateReset._id),
    templatePhone: String(templatePhone._id)
  };

  now = T0;
  buildServices(() => now);
});

const file = (kind: string, name = "file.png") => ({
  originalName: name,
  storedName: `${Date.now()}-${Math.random()}.png`,
  mimeType: "image/png",
  size: 1234,
  kind
});

async function createPlain(overrides: Record<string, unknown> = {}, who = requester()) {
  return commands.create(who, {
    title: "Khách không nhận được OTP",
    productId: ids.product,
    categoryId: ids.category,
    customer: { phone: "0912345678", name: "Khách A", appCode: "tikluy" },
    ...overrides
  } as any);
}

const activitiesOf = async (ticketId: string) =>
  (await TicketActivityModel.find({ ticket_id: ticketId }).sort({ createdAt: 1 }).lean()).map(
    (activity: any) => activity.action
  );

// ---- tạo ticket --------------------------------------------------------------------------------

describe("create", () => {
  it("tạo ticket thường: sinh mã tăng dần, ghi nhật ký, tính sẵn mốc cảnh báo", async () => {
    const first = await createPlain();
    const second = await createPlain({ title: "Ticket thứ hai" });

    expect(first.code).toBe("TK-2610-0001");
    expect(second.code).toBe("TK-2610-0002");
    expect(first.status).toBe("open");
    expect(await activitiesOf(first.id)).toEqual(["created"]);

    const doc: any = await TicketModel.findById(first.id).lean();
    expect(doc.created_by.toString()).toBe(REQUESTER);
    expect(doc.customer.phone).toBe("0912345678");
    expect(doc.alert_reason).toBe("unclaimed");
    expect(doc.alert_at).toBeInstanceOf(Date);
  });

  it("chọn mẫu: mức khẩn lấy theo mẫu; thiếu giấy tờ bắt buộc bị từ chối; file nhạy cảm được đánh dấu", async () => {
    await expect(
      commands.create(requester(), {
        title: "Reset thiết bị",
        productId: ids.product,
        templateId: ids.templateReset
      })
    ).rejects.toThrow(ArgumentInvalidException);

    const created = await commands.create(
      requester(),
      { title: "Reset thiết bị", productId: ids.product, templateId: ids.templateReset },
      [file("cccd_images", "cccd.png"), file("screenshot", "anh.png")]
    );
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.urgency).toBe("urgent");

    const attachments: any[] = await TicketAttachmentModel.find({ ticket_id: created.id }).lean();
    expect(attachments.find((item) => item.kind === "cccd_images").sensitive).toBe(true);
    expect(attachments.find((item) => item.kind === "screenshot").sensitive).toBe(false);
  });

  it("mẫu cần tờ trình mà chưa đính kèm → waiting_info + ticket hạn chế; thiếu trường bắt buộc bị từ chối", async () => {
    await expect(
      commands.create(requester(), {
        title: "Đổi SĐT",
        productId: ids.product,
        templateId: ids.templatePhone,
        customFields: {}
      })
    ).rejects.toThrow(/SĐT mới/);

    const created = await commands.create(requester(), {
      title: "Đổi SĐT",
      productId: ids.product,
      templateId: ids.templatePhone,
      customFields: { new_phone: "0987654321" }
    });
    expect(created.status).toBe("waiting_info");
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.visibility).toBe("restricted");
    expect(doc.approval).toMatchObject({ required: true, status: "missing" });
  });

  it("sản phẩm không tồn tại bị từ chối", async () => {
    await expect(createPlain({ productId: id() })).rejects.toThrow(ArgumentInvalidException);
  });

  it("giao việc khi tạo: chỉ ban lãnh đạo giao phòng; trưởng bộ phận chỉ giao người trong phòng mình", async () => {
    await expect(
      createPlain({ assignment: { mode: "department", departmentId: DEPT_IT } }, headIt())
    ).rejects.toThrow(TicketForbiddenError);
    await expect(
      createPlain({ assignment: { mode: "members", memberIds: [IT_C] } }, headIt())
    ).rejects.toThrow(TicketForbiddenError);
    await expect(
      createPlain({ assignment: { mode: "members", memberIds: [IT_A] } }, requester())
    ).rejects.toThrow(TicketForbiddenError);

    const ok = await createPlain(
      { assignment: { mode: "members", memberIds: [IT_A, IT_B] } },
      headIt()
    );
    expect(ok.status).toBe("open");
    const byBoss = await createPlain(
      { assignment: { mode: "department", departmentId: DEPT_IT } },
      boss()
    );
    expect(byBoss.status).toBe("open");
  });
});

// ---- nhận việc ---------------------------------------------------------------------------------

describe("claim — chống hai người cùng nhận", () => {
  it("hai người nhận cùng lúc: chỉ một người thành chủ trì, người kia nhận lỗi nêu tên người đã nhận", async () => {
    const created = await createPlain();
    const results = await Promise.allSettled([
      commands.claim(itA(), created.id),
      commands.claim(itB(), created.id)
    ]);

    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter(
      (item) => item.status === "rejected"
    ) as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(TicketAlreadyClaimedError);
    expect(rejected[0].reason.message).toMatch(/IT [AB] đã nhận/);

    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("in_progress");
    expect([IT_A, IT_B]).toContain(String(doc.assignment.owner_id));
    expect(doc.assignment.collaborator_ids).toHaveLength(0);
    expect((await activitiesOf(created.id)).filter((action) => action === "claimed")).toHaveLength(
      1
    );
  });

  it("giao đích danh: người ngoài danh sách không nhận được, người trong danh sách nhận được", async () => {
    const created = await createPlain(
      { assignment: { mode: "members", memberIds: [IT_A, IT_B] } },
      boss()
    );
    await expect(commands.claim(actor(IT_C), created.id)).rejects.toThrow();
    await commands.claim(itB(), created.id);
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(String(doc.assignment.owner_id)).toBe(IT_B);
    expect(doc.assignment.collaborator_ids.map(String)).toEqual([IT_A]);
  });

  it("giao cho phòng ban: thành viên phòng đó (kể cả người ở phòng con) nhận được", async () => {
    const created = await createPlain(
      { assignment: { mode: "department", departmentId: DEPT_KHOI } },
      boss()
    );
    // IT_A thuộc IT, IT nằm dưới KHOI → departmentIds có KHOI
    await commands.claim(itA(), created.id);
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(String(doc.assignment.owner_id)).toBe(IT_A);
  });
});

// ---- phối hợp, optimistic concurrency ----------------------------------------------------------

describe("nhóm xử lý", () => {
  it("người trong nhóm thêm phối hợp (kể cả ngoài phòng); người ngoài nhóm không thêm được; phối hợp đổi được trạng thái", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);

    await expect(commands.addCollaborator(stranger(), created.id, IT_B)).rejects.toThrow(
      TicketForbiddenError
    );
    await commands.addCollaborator(itA(), created.id, IT_C);
    await commands.hold(actor(IT_C), created.id, { reason: "Chờ ngân hàng" }); // phối hợp đổi trạng thái được

    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("on_hold");
    expect(doc.assignment.collaborator_ids.map(String)).toEqual([IT_C]);
  });

  it("hai thao tác ghi đồng thời: người sau nhận lỗi version, không ghi đè âm thầm", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);

    const results = await Promise.allSettled([
      commands.hold(itA(), created.id, { reason: "Chờ dev release" }),
      commands.resolve(itA(), created.id, { note: "Xong" })
    ]);
    const rejected = results.filter(
      (item) => item.status === "rejected"
    ) as PromiseRejectedResult[];
    // Một thao tác thắng; thao tác kia thua ở version (hoặc ở chuyển trạng thái nếu chạy tuần tự)
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect([TicketVersionConflictError.name, "TicketInvalidTransitionError"]).toContain(
      rejected[0].reason.constructor.name
    );
  });
});

// ---- luồng đầy đủ ------------------------------------------------------------------------------

describe("luồng xử lý đầy đủ", () => {
  it("tạo → nhận → yêu cầu bổ sung → bổ sung → xử lý xong → người tạo xác nhận", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.requestInfo(itA(), created.id, {
      items: [{ key: "screenshot" }, { key: "other", note: "Số điện thoại khách đang dùng" }]
    });
    expect((await TicketModel.findById(created.id).lean())?.status).toBe("waiting_info");

    await commands.submitInfo(requester(), created.id, {}, [file("screenshot")]);
    expect((await TicketModel.findById(created.id).lean())?.status).toBe("in_progress");

    await commands.resolve(itA(), created.id, {
      note: "Đã reset OTP",
      actionTaken: "Reset trên CMS TIKLUY, userId abc"
    });
    await commands.confirm(requester(), created.id);

    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("closed");
    expect(doc.confirmed_by_requester).toBe(true);
    expect(doc.reopen_until).toBeNull();
    expect(doc.resolution.action_taken).toBe("Reset trên CMS TIKLUY, userId abc");
    expect(doc.version).toBeGreaterThanOrEqual(5);
    expect(await activitiesOf(created.id)).toEqual([
      "created",
      "claimed",
      "info_requested",
      "info_submitted",
      "resolved",
      "confirmed"
    ]);
    // Người tạo đã xác nhận thì không mở lại được
    await expect(commands.reopen(requester(), created.id, "Vẫn lỗi")).rejects.toThrow();
  });

  it("tờ trình: không kết luận 'Đã giải quyết' khi chưa xác nhận hợp lệ; người tạo không tự xác nhận", async () => {
    const created = await commands.create(
      requester(),
      {
        title: "Đổi SĐT",
        productId: ids.product,
        templateId: ids.templatePhone,
        customFields: { new_phone: "0987654321" },
        approvalReference: { number: "TT-01", signer: "Giám đốc" }
      },
      [file("approval_document", "totrinh.pdf")]
    );
    expect(created.status).toBe("open");
    await commands.claim(itA(), created.id);

    await expect(commands.resolve(itA(), created.id, { note: "Xong" })).rejects.toThrow(
      /tờ trình/i
    );
    await expect(
      commands.verifyApproval(requester(), created.id, { valid: true })
    ).rejects.toThrow();

    await commands.verifyApproval(itA(), created.id, { valid: true });
    await commands.resolve(itA(), created.id, { note: "Đã đổi SĐT" });
    expect((await TicketModel.findById(created.id).lean())?.status).toBe("resolved");
  });

  it("tờ trình không hợp lệ → trả người tạo; bổ sung tờ trình mới mới gửi lại được", async () => {
    const created = await commands.create(
      requester(),
      {
        title: "Đổi SĐT",
        productId: ids.product,
        templateId: ids.templatePhone,
        customFields: { new_phone: "0987654321" }
      },
      [file("approval_document", "totrinh.pdf")]
    );
    await commands.claim(itA(), created.id);
    await commands.verifyApproval(itA(), created.id, { valid: false, note: "Thiếu chữ ký" });
    expect((await TicketModel.findById(created.id).lean())?.status).toBe("waiting_info");

    // Chưa tải tờ trình mới → không gửi lại được (file cũ không tính)
    await expect(commands.submitInfo(requester(), created.id, {})).rejects.toThrow();
    now = hoursLater(1);
    await commands.submitInfo(requester(), created.id, {}, [file("approval_document", "moi.pdf")]);
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("in_progress");
    expect(doc.approval.status).toBe("submitted");
  });

  it("đóng 'Trùng': chặn khi hai ticket thuộc hai khách khác nhau", async () => {
    const original = await createPlain({ customer: { phone: "0900000001" } });
    const other = await createPlain({ customer: { phone: "0900000002" } });
    await commands.claim(itA(), other.id);
    await expect(
      commands.close(itA(), other.id, { code: "duplicate", duplicateOf: original.id })
    ).rejects.toThrow(/khách khác nhau/);

    const sameCustomer = await createPlain({ customer: { phone: "0900000001" } });
    await commands.claim(itA(), sameCustomer.id);
    await commands.close(itA(), sameCustomer.id, { code: "duplicate", duplicateOf: original.id });
    expect((await TicketModel.findById(sameCustomer.id).lean())?.status).toBe("closed");
  });
});

// ---- quyền xem ---------------------------------------------------------------------------------

describe("ticket hạn chế", () => {
  async function restricted() {
    const created = await commands.create(
      requester(),
      {
        title: "Đổi SĐT",
        productId: ids.product,
        templateId: ids.templatePhone,
        customFields: { new_phone: "0987654321" }
      },
      [file("approval_document", "totrinh.pdf")]
    );
    return created;
  }

  it("người ngoài không thấy, không thao tác được; không lộ sự tồn tại", async () => {
    const created = await restricted();
    await expect(queries.getById(stranger(), created.id)).rejects.toThrow(TicketNotFoundError);
    await expect(commands.claim(stranger(), created.id)).rejects.toThrow(TicketNotFoundError);
    const list = await queries.list(stranger(), { tab: "all" });
    expect(list.data.find((row) => row.id === created.id)).toBeUndefined();
  });

  it("người có quyền xem ticket hạn chế thấy đầy đủ; người tạo thấy khi chưa đóng", async () => {
    const created = await restricted();
    expect((await queries.getById(boss(), created.id)).accessLevel).toBe("full");
    expect((await queries.getById(requester(), created.id)).accessLevel).toBe("full");
  });

  it("sau khi đóng, người tạo chỉ còn thông tin chung nhưng vẫn mở lại được trong hạn", async () => {
    const created = await restricted();
    await commands.claim(boss(), created.id);
    await commands.close(boss(), created.id, {
      code: "insufficient_basis",
      note: "Chưa đủ căn cứ"
    });

    const detail: any = await queries.getById(requester(), created.id);
    expect(detail.accessLevel).toBe("summary");
    expect(detail.resolution.label).toBe("Chưa đủ cơ sở");
    expect(detail.messages).toBeUndefined();
    expect(detail.attachments).toBeUndefined();
    expect(detail.capabilities.reopen).toBe(true);

    await commands.reopen(requester(), created.id, "Bổ sung thêm căn cứ");
    expect((await TicketModel.findById(created.id).lean())?.status).toBe("in_progress");
  });

  it("file nhạy cảm: người có quyền mở được; người không còn quyền chỉ thấy dòng thông tin, không có tên file", async () => {
    const created = await commands.create(
      requester(),
      { title: "Reset thiết bị", productId: ids.product, templateId: ids.templateReset },
      [file("cccd_images", "cccd-nguyen-van-a.png")]
    );
    await commands.claim(itA(), created.id);

    const forHandler: any = await queries.getById(itA(), created.id);
    expect(forHandler.attachments[0]).toMatchObject({
      canOpen: true,
      name: "cccd-nguyen-van-a.png"
    });

    // Ticket thường (ai cũng xem được) nhưng người ngoài không mở được file CCCD
    const forStranger: any = await queries.getById(stranger(), created.id);
    expect(forStranger.attachments[0]).toMatchObject({
      sensitive: true,
      canOpen: false,
      name: null,
      mimeType: null
    });
    await expect(
      queries.getAttachmentFile(stranger(), created.id, forStranger.attachments[0].id)
    ).rejects.toThrow();

    // Sau khi đóng, người tạo cũng mất quyền xem file
    await commands.close(itA(), created.id, { code: "solved" });
    const afterClose: any = await queries.getById(requester(), created.id);
    expect(afterClose.attachments[0].canOpen).toBe(false);
  });
});

// ---- danh sách / tab ---------------------------------------------------------------------------

describe("danh sách", () => {
  it("các tab lọc đúng theo quan hệ với người xem", async () => {
    const free = await createPlain({ title: "Không giao" });
    const toMembers = await createPlain(
      { title: "Giao đích danh", assignment: { mode: "members", memberIds: [IT_B] } },
      boss()
    );
    const toDept = await createPlain(
      { title: "Giao phòng", assignment: { mode: "department", departmentId: DEPT_IT } },
      boss()
    );
    await commands.claim(itA(), free.id);

    const idsOf = async (who: TicketActor, tab: string) =>
      (await queries.list(who, { tab })).data.map((row) => row.id);

    expect(await idsOf(itA(), "mine")).toEqual([free.id]);
    expect(await idsOf(requester(), "created")).toEqual([free.id]);
    expect(await idsOf(itB(), "assigned_to_me")).toEqual([toMembers.id]);
    // IT_A thuộc phòng IT nên thấy ticket giao phòng IT ở "my_department" và "unclaimed"
    expect(await idsOf(itA(), "my_department")).toEqual([toDept.id]);
    const unclaimedForA = await idsOf(itA(), "unclaimed");
    expect(unclaimedForA).toContain(toDept.id);
    expect(unclaimedForA).not.toContain(toMembers.id); // giao đích danh cho người khác
    expect(unclaimedForA).not.toContain(free.id); // đã có chủ trì

    const counts = await queries.counts(itB());
    expect(counts.assigned_to_me).toBe(1);
  });

  it("từ khoá tìm kiếm được escape (không coi là regex)", async () => {
    await createPlain({ title: "Lỗi (OTP) khách" });
    const found = await queries.list(requester(), { q: "(OTP)" });
    expect(found.total).toBe(1);
    const injection = await queries.list(requester(), { q: ".*" });
    expect(injection.total).toBe(0);
  });

  it("cảnh báo vàng: ticket open quá ngưỡng bị bôi vàng và vào tab 'yellow', không gửi thông báo", async () => {
    const created = await createPlain();
    expect((await queries.list(itA(), { tab: "yellow" })).total).toBe(0);

    now = hoursLater(48);
    const yellow = await queries.list(itA(), { tab: "yellow" });
    expect(yellow.data.map((row) => row.id)).toEqual([created.id]);
    expect(yellow.data[0].yellow).toMatchObject({ reason: "unclaimed" });
    expect(notifier.sent.filter((item) => item.type === "yellow")).toHaveLength(0);
  });
});

// ---- trao đổi ----------------------------------------------------------------------------------

describe("addMessage", () => {
  it("tin nhắn của nhóm xử lý tính là hoạt động; tin nhắn của người tạo không đổi ticket", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    const before: any = await TicketModel.findById(created.id).lean();

    now = hoursLater(2);
    await commands.addMessage(requester(), created.id, { body: "Khách vẫn chưa nhận được" });
    const afterRequester: any = await TicketModel.findById(created.id).lean();
    expect(afterRequester.version).toBe(before.version);
    expect(afterRequester.last_activity_at).toEqual(before.last_activity_at);

    now = hoursLater(3);
    await commands.addMessage(itA(), created.id, { body: "Đang kiểm tra" }, [file("screenshot")]);
    const afterHandler: any = await TicketModel.findById(created.id).lean();
    expect(afterHandler.version).toBe(before.version + 1);
    expect(afterHandler.last_activity_at).toEqual(hoursLater(3));

    expect(await TicketMessageModel.countDocuments({ ticket_id: created.id })).toBe(2);
    const detail: any = await queries.getById(itA(), created.id);
    expect(detail.messages.map((message: any) => message.body)).toEqual([
      "Khách vẫn chưa nhận được",
      "Đang kiểm tra"
    ]);
    expect(detail.attachments[0].messageId).toBe(detail.messages[1].id);
  });

  it("nhắc tên gửi thông báo cho người được nhắc; tin nhắn rỗng bị từ chối; ticket đã đóng không nhắn được", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.addMessage(requester(), created.id, {
      body: "Nhờ anh xem giúp",
      mentionIds: [IT_B]
    });
    expect(notifier.sent.find((item) => item.type === "mention")?.employeeIds).toEqual([IT_B]);

    await expect(commands.addMessage(requester(), created.id, { body: "  " })).rejects.toThrow(
      ArgumentInvalidException
    );
    await commands.close(itA(), created.id, { code: "not_a_bug", note: "Hệ thống đúng nghiệp vụ" });
    await expect(commands.addMessage(requester(), created.id, { body: "Thêm" })).rejects.toThrow(
      TicketForbiddenError
    );
  });
});

// ---- tự đóng / nhắc (cron) ---------------------------------------------------------------------

describe("TicketSweepService", () => {
  function sweepAt(clock: Date) {
    return new TicketSweepService({
      ...(createDefaultTicketDeps() as any),
      tickets: (commands as any).deps.tickets,
      activities: (commands as any).deps.activities,
      scheduler: (commands as any).deps.scheduler,
      notifier,
      directory,
      now: () => clock
    }).run();
  }

  it("ticket đã xử lý mà người tạo không xác nhận → tự đóng 'Đã giải quyết' sau 3 ngày làm việc, vẫn mở lại được", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.resolve(itA(), created.id, { note: "Xong" });

    expect((await sweepAt(hoursLater(24))).autoClosed).toBe(0); // chưa tới hạn
    expect((await TicketModel.findById(created.id).lean())?.status).toBe("resolved");

    const result = await sweepAt(new Date(T0.getTime() + 6 * 24 * 60 * 60 * 1000));
    expect(result.autoClosed).toBe(1);
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("closed");
    expect(doc.resolution.code).toBe("solved");
    expect(doc.confirmed_by_requester).toBe(false);
    expect(doc.reopen_until).toBeInstanceOf(Date);
    expect(await activitiesOf(created.id)).toContain("auto_closed");
  });

  it("chờ bổ sung quá hạn → tự đóng 'Người tạo không bổ sung'; trước đó nhắc người tạo đúng 1 lần", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.requestInfo(itA(), created.id, { items: [{ key: "screenshot" }] });

    // Sau 2 ngày làm việc: tới mốc nhắc
    const remindClock = new Date(T0.getTime() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
    const first = await sweepAt(remindClock);
    expect(first.reminded).toBe(1);
    expect(notifier.sent.filter((item) => item.type === "auto_close_reminder")).toHaveLength(1);
    const second = await sweepAt(remindClock);
    expect(second.reminded).toBe(0);

    const closeClock = new Date(T0.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect((await sweepAt(closeClock)).autoClosed).toBe(1);
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("closed");
    expect(doc.resolution.code).toBe("requester_no_response");
  });

  it("'Cần theo dõi thêm': không tự đóng trước ngày kiểm tra, tới ngày kiểm tra nhắc chủ trì", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    const checkAt = new Date("2026-11-12T09:00:00+07:00");
    await commands.resolve(itA(), created.id, {
      note: "Đã bù lãi",
      followUp: { note: "Kiểm tra kỳ lãi sau", checkAt }
    });

    expect((await sweepAt(new Date("2026-11-06T09:00:00+07:00"))).autoClosed).toBe(0);
    const atCheck = await sweepAt(new Date("2026-11-12T10:00:00+07:00"));
    expect(atCheck.reminded).toBe(1);
    const reminder = notifier.sent.find((item) => item.type === "follow_up_reminder");
    expect(reminder?.employeeIds).toEqual([IT_A]);
  });
});

// ---- liên kết, sửa -----------------------------------------------------------------------------

describe("sửa và liên kết", () => {
  it("người tạo sửa nội dung, nhóm xử lý đổi mức khẩn kèm ghi chú; ghi lại giá trị cũ → mới", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);

    await commands.edit(requester(), created.id, { title: "Tiêu đề đã sửa" });
    await expect(commands.edit(itA(), created.id, { urgency: "urgent" })).rejects.toThrow();
    await commands.edit(itA(), created.id, { urgency: "urgent" }, "Khách bị khoá tài khoản");

    const activity: any = await TicketActivityModel.findOne({
      ticket_id: created.id,
      action: "edited"
    })
      .sort({ createdAt: 1 })
      .lean();
    expect(activity.changes[0]).toMatchObject({ field: "title", to: "Tiêu đề đã sửa" });
    expect((await TicketModel.findById(created.id).lean())?.urgency).toBe("urgent");
  });

  it("liên kết 'liên quan' không lộ ticket hạn chế người dùng không xem được", async () => {
    // Người xử lý KHÔNG có quyền xem ticket hạn chế
    const plain = actor(IT_A);
    const created = await createPlain();
    await commands.claim(plain, created.id);
    const secret = await commands.create(
      requester(),
      {
        title: "Đổi SĐT",
        productId: ids.product,
        templateId: ids.templatePhone,
        customFields: { new_phone: "0987654321" }
      },
      [file("approval_document")]
    );
    await expect(commands.linkRelated(plain, created.id, secret.id)).rejects.toThrow(
      TicketNotFoundError
    );
    const other = await createPlain({ title: "Cùng lỗi, khách khác" });
    await commands.linkRelated(plain, created.id, other.id);
    expect((await TicketModel.findById(created.id).lean())?.related_ticket_ids).toHaveLength(1);
  });
});
