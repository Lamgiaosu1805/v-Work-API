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
import { TicketConfigService } from "../../../src/modules/ticket/application/ticket-config.service";
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
  TicketInvalidTransitionError,
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

  async getDepartmentMemberIds(departmentId: string) {
    return Object.entries(EMPLOYEES)
      .filter(([, employee]) => employee.departments.includes(departmentId))
      .map(([employeeId]) => employeeId);
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

  async searchEmployees(
    query: string,
    limit: number,
    onlyIds?: string[]
  ): Promise<EmployeeSummary[]> {
    const keyword = query.trim().toLowerCase();
    return Object.entries(EMPLOYEES)
      .filter(([employeeId]) => !onlyIds || onlyIds.includes(employeeId))
      .filter(([, employee]) => employee.name.toLowerCase().includes(keyword))
      .slice(0, limit)
      .map(([employeeId, employee]) => ({
        id: employeeId,
        fullName: employee.name,
        accountId: employeeId,
        departmentNames: []
      }));
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
// IT có role "WORKPLACE_TICKET_STAFF": xem được ticket hạn chế và file nhạy cảm (xem scripts/seedPermissionTicketRoles.ts)
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

// Thứ Hai 09:00 (giờ VN) của tuần SAU tuần hiện tại: đồng hồ giả luôn nằm trong tương lai so với đồng hồ
// thật, vì createdAt của file đính kèm do Mongoose đặt bằng đồng hồ thật (xem hasKindSince).
function nextMondayNine(): Date {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const daysToMonday = (8 - vnNow.getUTCDay()) % 7 || 7;
  return new Date(
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + daysToMonday + 7, 2)
  );
}
const T0 = nextMondayNine();
const VN_T0 = new Date(T0.getTime() + 7 * 60 * 60 * 1000);
const CODE_PERIOD = `${String(VN_T0.getUTCFullYear()).slice(2)}${String(VN_T0.getUTCMonth() + 1).padStart(2, "0")}`;
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

    expect(first.code).toBe(`TK-${CODE_PERIOD}-0001`);
    expect(second.code).toBe(`TK-${CODE_PERIOD}-0002`);
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

    const idsOf = async (who: TicketActor, tab: string, scope?: string) =>
      (await queries.list(who, { tab, scope })).data.map((row) => row.id);

    // "Ticket của tôi": IT_A đang xử lý, người tạo thấy ticket mình tạo, IT_B được giao đích danh
    expect(await idsOf(itA(), "my", "handling")).toEqual([free.id]);
    expect(await idsOf(requester(), "my", "created")).toEqual([free.id]);
    expect(await idsOf(itB(), "my", "assigned")).toEqual([toMembers.id]);
    expect(await idsOf(itB(), "my")).toEqual([toMembers.id]);
    // Ticket giao phòng IT không nằm ở "Chưa ai nhận" (chỉ ticket chưa giao ai) mà ở "Ticket phòng ban"
    const unclaimed = await idsOf(itA(), "unclaimed");
    expect(unclaimed).not.toContain(toDept.id);
    expect(unclaimed).not.toContain(toMembers.id);
    expect(unclaimed).not.toContain(free.id); // đã có chủ trì
    expect(await idsOf(itA(), "department", "waiting")).toEqual([toDept.id]);

    const counts = await queries.counts(itB());
    expect(counts).toMatchObject({ my: 1, needs_reply: 0, unclaimed: 0, yellow: 0 });
  });

  it("'Ticket của tôi' giữ ticket đã đóng; chip 'Đang mở' thì loại ra; 'Cần tôi phản hồi' chỉ ticket chờ mình", async () => {
    const open = await createPlain({ title: "Đang mở" });
    const waiting = await createPlain({ title: "Chờ bổ sung" });
    const done = await createPlain({ title: "Đã xong" });
    await commands.claim(itA(), waiting.id);
    await commands.requestInfo(itA(), waiting.id, { items: [{ key: "description" }] });
    await commands.claim(itA(), done.id);
    await commands.close(itA(), done.id, { code: "solved" });

    const listIds = async (tab: string, scope?: string) =>
      (await queries.list(requester(), { tab, scope })).data.map((row) => row.id).sort();

    expect(await listIds("my")).toEqual([open.id, waiting.id, done.id].sort());
    expect(await listIds("my", "open")).toEqual([open.id, waiting.id].sort());
    expect(await listIds("needs_reply")).toEqual([waiting.id]);
    // Badge của "Ticket của tôi" chỉ đếm ticket đang mở
    expect((await queries.counts(requester())).my).toBe(2);
    expect((await queries.counts(requester())).needs_reply).toBe(1);
  });

  it("total: đếm ticket khác nhau, ticket nằm ở nhiều tab chỉ tính một lần", async () => {
    const unclaimed = await createPlain({ title: "Chưa ai nhận" });
    const waiting = await createPlain({ title: "Chờ bổ sung" });
    await commands.claim(itA(), waiting.id);
    await commands.requestInfo(itA(), waiting.id, { items: [{ key: "description" }] });

    const counts = await queries.counts(requester());
    // Ticket "unclaimed" nằm ở "Ticket của tôi" + "Chưa ai nhận"; ticket "waiting" ở "Ticket của tôi" + "Cần tôi phản hồi"
    expect(counts).toMatchObject({ my: 2, needs_reply: 1, unclaimed: 1 });
    expect(counts.my + counts.needs_reply + counts.unclaimed).toBe(4);
    expect(counts.total).toBe(2);
    expect(unclaimed.id).not.toBe(waiting.id);

    // Người ngoài không liên quan: chỉ thấy ticket chưa ai nhận (ai cũng nhận được)
    expect((await queries.counts(stranger())).total).toBe(1);
  });

  it("'Ticket phòng ban': giao cho phòng + việc của người trong phòng, gồm cả phòng con", async () => {
    // HEAD_IT quản lý cây IT (IT_A, IT_B, HEAD_IT) — xem FakeDirectory.getOwnDepartmentTreeEmployeeIds
    const toDept = await createPlain(
      { title: "Giao phòng IT", assignment: { mode: "department", departmentId: DEPT_IT } },
      boss()
    );
    const handledByIt = await createPlain({ title: "IT_A đang làm" });
    await commands.claim(itA(), handledByIt.id);
    const createdByIt = await createPlain({ title: "IT_B tạo" }, itB());
    const unrelated = await createPlain({ title: "Việc của CSKH" });

    const listIds = async (scope?: string) =>
      (await queries.list(headIt(), { tab: "department", scope })).data.map((row) => row.id).sort();

    expect(await listIds("waiting")).toEqual([toDept.id]);
    expect(await listIds("handling")).toEqual([handledByIt.id]);
    expect(await listIds("created")).toEqual([createdByIt.id]);
    const all = await listIds();
    expect(all).toEqual([toDept.id, handledByIt.id, createdByIt.id].sort());
    expect(all).not.toContain(unrelated.id);

    // Badge tab phòng ban chỉ đếm ticket đã giao cho phòng và đang chờ nhận
    expect((await queries.counts(headIt())).department).toBe(1);
  });

  it("'Chưa ai nhận' chỉ gồm ticket chưa giao ai", async () => {
    const free = await createPlain({ title: "Chưa giao" });
    await createPlain(
      { title: "Giao người", assignment: { mode: "members", memberIds: [IT_B] } },
      boss()
    );
    const result = await queries.list(itA(), { tab: "unclaimed" });
    expect(result.data.map((row) => row.id)).toEqual([free.id]);
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

  const messageNotices = () =>
    notifier.sent.filter((item) => item.type === "message" || item.type === "mention");

  it("tin nhắn mới báo người tạo và chủ trì; người gửi không tự nhận", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    notifier.sent = [];

    await commands.addMessage(requester(), created.id, { body: "Khách vẫn chưa nhận được" });
    expect(messageNotices()).toHaveLength(1);
    expect(messageNotices()[0]).toMatchObject({
      type: "message",
      employeeIds: [IT_A],
      title: `Có trao đổi mới trong ticket ${created.code}`,
      body: "Người tạo: Khách vẫn chưa nhận được"
    });

    notifier.sent = [];
    await commands.addMessage(itA(), created.id, { body: "Đang kiểm tra" });
    expect(messageNotices().map((item) => item.employeeIds)).toEqual([[REQUESTER]]);
  });

  it("nhắc tên: người được nhắc nhận thông báo nhắc tên, những người khác nhận thông báo chung", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    notifier.sent = [];

    await commands.addMessage(requester(), created.id, {
      body: "Nhờ anh B xem",
      mentionIds: [IT_B]
    });
    expect(messageNotices().map((item) => [item.type, item.employeeIds])).toEqual([
      ["mention", [IT_B]],
      ["message", [IT_A]]
    ]);
  });

  it("nhắc chủ trì thì chủ trì chỉ nhận thông báo nhắc tên (không nhận trùng)", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    notifier.sent = [];

    await commands.addMessage(requester(), created.id, { body: "Anh A ơi", mentionIds: [IT_A] });
    expect(messageNotices().map((item) => [item.type, item.employeeIds])).toEqual([
      ["mention", [IT_A]]
    ]);
  });

  it("ticket chưa ai nhận: báo người phụ trách của sản phẩm (và danh sách mặc định nếu ticket Khẩn/Cao)", async () => {
    await TicketProductModel.updateOne({ _id: ids.product }, { handler_ids: [IT_B] });
    await TicketSettingModel.create({ key: "default", default_handler_ids: [IT_C] });
    const normal = await createPlain();
    const urgent = await createPlain({ urgency: "urgent" });
    notifier.sent = [];

    await commands.addMessage(requester(), normal.id, { body: "Khách hỏi lại" });
    expect(messageNotices().map((item) => item.employeeIds)).toEqual([[IT_B]]);

    notifier.sent = [];
    await commands.addMessage(requester(), urgent.id, { body: "Khách hỏi lại" });
    expect(messageNotices().map((item) => item.employeeIds)).toEqual([[IT_B, IT_C]]);
  });

  it("ticket hạn chế không đính kèm nội dung vào thông báo tin nhắn", async () => {
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
    await commands.claim(itA(), secret.id);
    notifier.sent = [];

    await commands.addMessage(requester(), secret.id, { body: "Khách 0912345678 tăng lãi lên 9%" });
    expect(messageNotices()[0].body).toBe("Người tạo đã gửi tin nhắn mới");
  });

  it("lỗi gửi thông báo không làm hỏng việc gửi tin nhắn", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    notifier.notify = async () => {
      throw new Error("FCM lỗi");
    };

    const result = await commands.addMessage(requester(), created.id, { body: "Vẫn lưu được" });
    expect(result.messageId).toBeTruthy();
    expect(await TicketMessageModel.countDocuments({ ticket_id: created.id })).toBe(1);
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
    const checkAt = new Date(T0.getTime() + 17 * 24 * 60 * 60 * 1000);
    await commands.resolve(itA(), created.id, {
      note: "Đã bù lãi",
      followUp: { note: "Kiểm tra kỳ lãi sau", checkAt }
    });

    expect((await sweepAt(new Date(T0.getTime() + 11 * 24 * 60 * 60 * 1000))).autoClosed).toBe(0);
    const atCheck = await sweepAt(new Date(checkAt.getTime() + 60 * 60 * 1000));
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

// ---- lỗi bảo mật / vận hành đã sửa -------------------------------------------------------------

describe("file nhạy cảm do server quyết định", () => {
  it("file gửi để đáp lại yêu cầu CCCD luôn nhạy cảm dù người dùng để loại là 'other'", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.requestInfo(itA(), created.id, { items: [{ key: "cccd_images" }] });

    await commands.submitInfo(requester(), created.id, {}, [file("other", "cccd.png")]);

    const [attachment]: any[] = await TicketAttachmentModel.find({ ticket_id: created.id }).lean();
    expect(attachment.kind).toBe("other");
    expect(attachment.sensitive).toBe(true);
    // Ticket thường ai cũng xem được, nhưng người ngoài không mở được file này
    const forStranger: any = await queries.getById(stranger(), created.id);
    expect(forStranger.attachments[0]).toMatchObject({ canOpen: false, name: null });
  });

  it("file gửi qua chat khi đang chờ giấy tờ nhạy cảm cũng nhạy cảm; bình thường thì không", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);

    await commands.addMessage(requester(), created.id, { body: "Ảnh lỗi" }, [
      file("other", "a.png")
    ]);
    await commands.requestInfo(itA(), created.id, { items: [{ key: "transaction_proof" }] });
    await commands.addMessage(requester(), created.id, { body: "Chứng từ đây" }, [
      file("other", "b.png")
    ]);

    const attachments: any[] = await TicketAttachmentModel.find({ ticket_id: created.id })
      .sort({ createdAt: 1 })
      .lean();
    expect(attachments.map((item) => item.sensitive)).toEqual([false, true]);
  });

  it("loại giấy tờ mẫu đánh dấu nhạy cảm cũng được áp khi gửi qua chat (không chỉ lúc tạo)", async () => {
    const category = await TicketCategoryModel.findOne({}).lean();
    const template = await TicketTemplateModel.create({
      code: "sim_check",
      name: "Kiểm tra SIM",
      category_id: category?._id,
      required_documents: [
        { kind: "sim_proof", label: "Chủ SIM", required: false, sensitive: true }
      ]
    });
    const created = await createPlain({ templateId: String(template._id) });
    await commands.claim(itA(), created.id);

    await commands.addMessage(requester(), created.id, { body: "Giấy tờ SIM" }, [
      file("sim_proof", "sim.png")
    ]);
    const attachment: any = await TicketAttachmentModel.findOne({ ticket_id: created.id }).lean();
    expect(attachment.sensitive).toBe(true);
  });
});

describe("ticket hạn chế giao cho phòng ban", () => {
  // Thành viên IT (thuộc Khối) nhưng KHÔNG có quyền xem ticket hạn chế
  const khoiMember = (employeeId = IT_B) =>
    actor(employeeId, { departmentIds: [DEPT_IT, DEPT_KHOI] });

  async function assignedToKhoi() {
    return commands.create(
      boss(),
      {
        title: "Đổi SĐT",
        productId: ids.product,
        templateId: ids.templatePhone,
        customFields: { new_phone: "0987654321" },
        assignment: { mode: "department", departmentId: DEPT_KHOI }
      },
      [file("approval_document", "totrinh.pdf")]
    );
  }

  it("thành viên phòng được giao thấy ticket, có trong tab 'giao cho phòng tôi' và nhận được", async () => {
    const created = await assignedToKhoi();
    expect((await TicketModel.findById(created.id).lean())?.visibility).toBe("restricted");

    const detail: any = await queries.getById(khoiMember(), created.id);
    expect(detail.accessLevel).toBe("full");
    // File tờ trình vẫn là nhạy cảm: chưa nhận thì chưa mở được
    expect(detail.attachments[0]).toMatchObject({ canOpen: false, name: null });

    const list = await queries.list(khoiMember(), { tab: "department", scope: "waiting" });
    expect(list.data.map((row) => row.id)).toContain(created.id);

    await commands.claim(khoiMember(), created.id);
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(String(doc.assignment.owner_id)).toBe(IT_B);
  });

  it("người phòng khác vẫn không thấy; sau khi có chủ trì, thành viên khác của phòng không còn thấy", async () => {
    const created = await assignedToKhoi();
    await expect(queries.getById(stranger(), created.id)).rejects.toThrow(TicketNotFoundError);

    await commands.claim(khoiMember(IT_B), created.id);
    await expect(queries.getById(khoiMember(HEAD_IT), created.id)).rejects.toThrow(
      TicketNotFoundError
    );
    const list = await queries.list(khoiMember(HEAD_IT), { tab: "all" });
    expect(list.data.find((row) => row.id === created.id)).toBeUndefined();
  });
});

describe("cài đặt chung: kiểm tra trước khi lưu", () => {
  const config = () => new TicketConfigService(directory);
  const expectRejected = async (input: Record<string, unknown>) => {
    await expect(config().updateSettings(input)).rejects.toThrow(ArgumentInvalidException);
    // Không ghi gì xuống DB
    expect(await TicketSettingModel.countDocuments({})).toBe(0);
  };

  it("từ chối lịch làm việc sai (giờ kết thúc <= bắt đầu, không có ngày làm, khung giờ T7 sai)", async () => {
    await expectRejected({ workStartMinute: 600, workEndMinute: 600 });
    // Chỉ gửi giờ kết thúc: phải so với giờ bắt đầu hiện có (08:00)
    await expectRejected({ workEndMinute: 7 * 60 });
    await expectRejected({ workDays: [] });
    await expectRejected({ workDays: [1, 9] });
    await expectRejected({ dayWindows: { 6: { startMinute: 720, endMinute: 480 } } });
    await expectRejected({ dayWindows: { 8: { startMinute: 480, endMinute: 720 } } });
  });

  it("từ chối ngưỡng cảnh báo bằng 0 / không phải số / mức khẩn lạ", async () => {
    await expectRejected({ unclaimedMinutes: { normal: 0 } });
    await expectRejected({ silentMinutes: { urgent: "" } });
    await expectRejected({ silentMinutes: { gấp: 60 } });
  });

  it("từ chối ngưỡng sai thứ tự: mức gấp hơn không được dài hơn mức ít gấp", async () => {
    // Cao (mặc định 540') dài hơn Bình thường, hoặc Khẩn (mặc định 360') dài hơn Cao
    await expectRejected({ unclaimedMinutes: { normal: 100 } });
    await expectRejected({ unclaimedMinutes: { urgent: 600 } });
    await expectRejected({ silentMinutes: { high: 5000 } });
    // Gửi đủ 4 mức mà vẫn sai thứ tự
    await expectRejected({ unclaimedMinutes: { urgent: 60, high: 600, normal: 540, low: 1620 } });
  });

  it("lưu hợp lệ vẫn được; sau khi bị từ chối, tạo ticket vẫn hoạt động bình thường", async () => {
    await expect(config().updateSettings({ workDays: [] })).rejects.toThrow();
    const created = await createPlain();
    expect(created.status).toBe("open");

    const saved = await config().updateSettings({
      workEndMinute: 18 * 60,
      unclaimedMinutes: { normal: 1500 },
      dayWindows: { 6: { startMinute: 480, endMinute: 720 } }
    });
    expect(saved.calendar.workEndMinute).toBe(18 * 60);
    expect(saved.policy.unclaimedMinutes.normal).toBe(1500);
  });
});

describe("nhắc tên trên ticket hạn chế", () => {
  it("không đính kèm nội dung tin nhắn vào thông báo; ticket thường vẫn kèm nội dung", async () => {
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
    await commands.addMessage(requester(), secret.id, {
      body: "Khách 0912345678 tăng lãi 7% lên 9%",
      mentionIds: [IT_B]
    });
    const secretMention = notifier.sent.find((item) => item.type === "mention");
    expect(secretMention?.employeeIds).toEqual([IT_B]);
    expect(secretMention?.body).toBe("");

    notifier.sent = [];
    const plain = await createPlain();
    await commands.addMessage(requester(), plain.id, { body: "Nhờ anh xem", mentionIds: [IT_B] });
    expect(notifier.sent.find((item) => item.type === "mention")?.body).toBe("Nhờ anh xem");
  });
});

describe("người phụ trách cấp sản phẩm", () => {
  it("lưu người phụ trách cho sản phẩm, trả kèm tên ở màn cấu hình và không lộ ở danh mục cho người dùng thường", async () => {
    const config = new TicketConfigService(directory);
    const created: any = await config.create("products", {
      code: "tikluy_web",
      name: "TIKLUY WEB",
      handlerIds: [IT_A, IT_B]
    });
    expect(created.handlerIds).toEqual([IT_A, IT_B]);

    const listed: any[] = await config.list("products");
    const row = listed.find((item) => item.code === "tikluy_web");
    expect(row.handlers.map((person: any) => person.fullName)).toEqual(["IT A", "IT B"]);

    const updated: any = await config.update("products", created.id, { handlerIds: [IT_B] });
    expect(updated.handlerIds).toEqual([IT_B]);
    await expect(
      config.update("products", created.id, { handlerIds: ["không-hợp-lệ"] })
    ).rejects.toThrow(ArgumentInvalidException);

    const meta: any = await queries.meta(requester());
    expect(meta.products.length).toBeGreaterThan(0);
    meta.products.forEach((product: any) => expect(product.handlerIds).toBeUndefined());
  });
});

describe("mã khách (externalId) chỉ trả cho người cần dùng", () => {
  const customer = {
    phone: "0912345678",
    name: "Khách A",
    appCode: "tikluy",
    externalId: "user-123"
  };

  it("người thường không nhận mã; người có quyền xem khách hàng nhận mã nhưng không hiển thị; IT và nhóm xử lý thấy", async () => {
    const created = await createPlain({ customer });
    await commands.claim(itA(), created.id);

    // Người tạo (nhân viên thường): không có mã, không mở được hồ sơ
    const asRequester: any = await queries.getById(requester(), created.id);
    expect(asRequester.customer.externalId).toBeNull();
    expect(asRequester.customer.phone).toBe("0912345678");
    expect(asRequester.customerAccess).toEqual({
      linkedToCrm: true,
      showExternalId: false,
      canOpenProfile: false
    });

    // Người có quyền xem khách hàng (vd Sale): có mã trong dữ liệu để mở hồ sơ, nhưng không hiển thị
    const asSale: any = await queries.getById(
      actor(STRANGER, { canViewCustomer: true }),
      created.id
    );
    expect(asSale.customer.externalId).toBe("user-123");
    expect(asSale.customerAccess).toEqual({
      linkedToCrm: true,
      showExternalId: false,
      canOpenProfile: true
    });

    // IT (quyền xem ticket hạn chế / file nhạy cảm): thấy mã; không có quyền khách hàng thì chưa mở được hồ sơ
    const asIt: any = await queries.getById(itB(), created.id);
    expect(asIt.customer.externalId).toBe("user-123");
    expect(asIt.customerAccess).toEqual({
      linkedToCrm: true,
      showExternalId: true,
      canOpenProfile: false
    });

    // Nhóm xử lý (chủ trì) thấy mã dù không có role IT
    const asOwner: any = await queries.getById(
      actor(IT_A, { departmentIds: [DEPT_IT] }),
      created.id
    );
    expect(asOwner.customerAccess.showExternalId).toBe(true);
  });

  it("danh sách không bao giờ trả mã khách; ticket không có mã thì không có liên kết", async () => {
    await createPlain({ customer });
    const list = await queries.list(itA(), { tab: "all" });
    expect(list.data[0].customer).toMatchObject({ phone: "0912345678", externalId: null });

    const noExternal = await createPlain({
      title: "Khách nhập tay",
      customer: { phone: "0900000001", name: "B" }
    });
    const detail: any = await queries.getById(
      actor(STRANGER, { canViewCustomer: true }),
      noExternal.id
    );
    expect(detail.customerAccess).toEqual({
      linkedToCrm: false,
      showExternalId: false,
      canOpenProfile: false
    });
  });
});

describe("nhân sự liên quan (sản phẩm nội bộ)", () => {
  it("gắn nhân sự khi tạo: lưu id, chi tiết và danh sách trả tên", async () => {
    const created = await createPlain({
      title: "Reset mật khẩu HRM",
      customer: null,
      relatedEmployeeId: IT_C
    });

    expect(String((await TicketModel.findById(created.id).lean())?.related_employee_id)).toBe(IT_C);

    const detail: any = await queries.getById(requester(), created.id);
    expect(detail.relatedEmployee).toMatchObject({ id: IT_C, name: "IT C" });
    expect(detail.customer).toBeNull();

    const list = await queries.list(requester(), { tab: "all" });
    expect(list.data[0].relatedEmployee).toEqual({ id: IT_C, name: "IT C" });
  });

  it("ticket không gắn nhân sự thì trả null", async () => {
    const created = await createPlain();
    const detail: any = await queries.getById(requester(), created.id);
    expect(detail.relatedEmployee).toBeNull();
    expect((await queries.list(requester(), { tab: "all" })).data[0].relatedEmployee).toBeNull();
  });

  it("nhân sự không tồn tại hoặc id sai định dạng thì báo lỗi, không tạo ticket", async () => {
    await expect(createPlain({ relatedEmployeeId: id() })).rejects.toThrow(
      ArgumentInvalidException
    );
    await expect(createPlain({ relatedEmployeeId: "khong-phai-id" })).rejects.toThrow(
      ArgumentInvalidException
    );
    expect(await TicketModel.countDocuments()).toBe(0);
  });
});

// ---- rà soát phân tích luồng (28/10/2026) -------------------------------------------------------

describe("version do client gửi lên", () => {
  const versionOf = async (ticketId: string) =>
    ((await TicketModel.findById(ticketId).lean()) as any).version as number;

  it("lệch version (ticket đã bị người khác đổi) → báo tải lại, không ghi đè; đúng version → thành công", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    const seen = await versionOf(created.id);

    // Người tạo sửa tiêu đề sau khi nhóm xử lý đã mở trang → version tăng
    await commands.edit(requester(), created.id, { title: "Tiêu đề mới" });

    await expect(
      commands.hold(itA(), created.id, { reason: "Chờ ngân hàng" }, seen)
    ).rejects.toThrow(TicketVersionConflictError);
    expect(((await TicketModel.findById(created.id).lean()) as any).status).toBe("in_progress");

    await commands.hold(
      itA(),
      created.id,
      { reason: "Chờ ngân hàng" },
      await versionOf(created.id)
    );
    expect(((await TicketModel.findById(created.id).lean()) as any).status).toBe("on_hold");
  });

  it("không gửi version thì giữ hành vi cũ (client cũ vẫn chạy)", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.edit(requester(), created.id, { title: "Tiêu đề mới" });
    await expect(commands.hold(itA(), created.id, { reason: "Chờ" })).resolves.toBeDefined();
  });
});

describe("mở lại: capability khớp entity", () => {
  it("người có ticket.manage nhưng không thuộc nhóm xử lý không thấy nút mở lại và không mở lại được", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.resolve(itA(), created.id, { note: "Xong" });

    const asBoss: any = await queries.getById(boss(), created.id);
    const asHandler: any = await queries.getById(itA(), created.id);
    expect(asBoss.capabilities.reopen).toBe(false);
    expect(asHandler.capabilities.reopen).toBe(true);
    await expect(commands.reopen(boss(), created.id, "Chưa ổn")).rejects.toThrow(
      TicketForbiddenError
    );
  });
});

describe("lịch sử sửa khách không lộ mã khách", () => {
  it("người ngoài nhóm xử lý thấy changes.customer đã bỏ externalId; nhóm xử lý / ticket.manage vẫn thấy", async () => {
    const customer = { phone: "0912345678", name: "Khách A", appCode: "tikluy" };
    const created = await createPlain({ customer: { ...customer, externalId: "u-1001" } });
    await commands.edit(requester(), created.id, {
      customer: { ...customer, externalId: "u-2002" }
    });

    const editedChange = (detail: any) =>
      detail.activities.find((activity: any) => activity.action === "edited").changes[0];

    const asStranger = editedChange(await queries.getById(stranger(), created.id));
    expect(asStranger.field).toBe("customer");
    expect(asStranger.from.externalId).toBeNull();
    expect(asStranger.to.externalId).toBeNull();
    expect(asStranger.to.phone).toBe("0912345678");

    const asBoss = editedChange(await queries.getById(boss(), created.id));
    expect(asBoss.to.externalId).toBe("u-2002");
  });
});

describe("ticket đã kết thúc không đổi nhóm / liên kết được nữa", () => {
  it("bỏ phối hợp và liên kết ticket bị chặn khi ticket đã đóng", async () => {
    const created = await createPlain();
    const other = await createPlain({ title: "Ticket khác" });
    await commands.claim(itA(), created.id);
    await commands.addCollaborator(itA(), created.id, IT_B);
    await commands.close(itA(), created.id, { code: "solved" });

    await expect(commands.removeCollaborator(itA(), created.id, IT_B)).rejects.toThrow(
      TicketInvalidTransitionError
    );
    await expect(commands.linkRelated(itA(), created.id, other.id)).rejects.toThrow(
      TicketInvalidTransitionError
    );
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.assignment.collaborator_ids.map(String)).toEqual([IT_B]);
    expect(doc.related_ticket_ids).toHaveLength(0);
  });
});

describe("đóng 'Trùng' không lộ ticket hạn chế", () => {
  it("ticket gốc hạn chế mà người đóng không xem được thì coi như không tồn tại", async () => {
    const plain = actor(IT_A); // không có quyền xem ticket hạn chế
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

    await expect(
      commands.close(plain, created.id, { code: "duplicate", duplicateOf: secret.id })
    ).rejects.toThrow(TicketNotFoundError);
    expect(((await TicketModel.findById(created.id).lean()) as any).status).toBe("in_progress");
  });
});

describe("chọn người để giao việc", () => {
  it("trưởng bộ phận chỉ thấy người trong phòng mình; ban lãnh đạo thấy mọi người", async () => {
    const asHead = await queries.searchEmployees("", 20, headIt());
    const headIds = asHead.map((employee: any) => employee.id);
    expect(headIds).toEqual(expect.arrayContaining([IT_A, IT_B]));
    expect(headIds).not.toContain(REQUESTER);

    const asBoss = await queries.searchEmployees("", 20, boss());
    expect(asBoss.map((employee: any) => employee.id)).toContain(REQUESTER);

    // Không yêu cầu lọc theo quyền giao (tìm người nhắc tên, phối hợp...) thì không giới hạn
    const unrestricted = await queries.searchEmployees("", 20);
    expect(unrestricted.map((employee: any) => employee.id)).toContain(REQUESTER);
  });
});

describe("capability liên kết ticket liên quan", () => {
  it("chỉ nhóm xử lý và chỉ khi ticket chưa kết thúc", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);

    const handlerView: any = await queries.getById(itA(), created.id);
    const strangerView: any = await queries.getById(stranger(), created.id);
    expect(handlerView.capabilities.linkRelated).toBe(true);
    expect(strangerView.capabilities.linkRelated).toBe(false);

    await commands.close(itA(), created.id, { code: "solved" });
    const afterClose: any = await queries.getById(itA(), created.id);
    expect(afterClose.capabilities.linkRelated).toBe(false);
  });
});

describe("thao tác nhanh trên danh sách", () => {
  it("mỗi dòng trả quyền thao tác của người xem và version; nhận xong thì quyền đổi theo", async () => {
    const created = await createPlain();

    const rowFor = async (who: TicketActor) =>
      ((await queries.list(who, { tab: "all" })) as any).data.find(
        (row: any) => row.id === created.id
      );

    const beforeIt = await rowFor(itA());
    expect(beforeIt.capabilities.claim).toBe(true);
    expect(beforeIt.capabilities.hold).toBe(false);
    expect(beforeIt.version).toBe(0);

    await commands.claim(itA(), created.id);
    const afterIt = await rowFor(itA());
    expect(afterIt.capabilities).toMatchObject({ claim: false, resolve: true, hold: true });
    expect(afterIt.version).toBe(1);

    // Người ngoài nhóm xử lý không có quyền xử lý; người tạo không thấy nút xác nhận khi chưa báo xong
    const asStranger = await rowFor(stranger());
    expect(asStranger.capabilities).toMatchObject({ claim: false, resolve: false, confirm: false });
    const asRequester = await rowFor(requester());
    expect(asRequester.capabilities.confirm).toBe(false);

    await commands.resolve(itA(), created.id, { note: "Xong" }, afterIt.version);
    expect((await rowFor(requester())).capabilities.confirm).toBe(true);
  });
});

// ---- rà soát 28/10: quyền xem sau khi rời nhóm, kẹt tạm hoãn, nhận khi đã có phối hợp ---------------

describe("quyền xem ticket hạn chế theo nhóm xử lý hiện tại", () => {
  async function restrictedAssigned() {
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
    await commands.assign(boss(), created.id, {
      mode: "members",
      memberIds: [IT_A, IT_B],
      ownerId: IT_A,
      assignedBy: BOSS
    } as any);
    return created;
  }

  it("người phối hợp bị gỡ không còn xem được ticket hạn chế", async () => {
    const created = await restrictedAssigned();
    // IT_B không có quyền xem ticket hạn chế theo vai trò, chỉ có tư cách người phối hợp
    const asB = actor(IT_B);
    expect(((await queries.getById(asB, created.id)) as any).accessLevel).toBe("full");

    await commands.removeCollaborator(itA(), created.id, IT_B);
    await expect(queries.getById(asB, created.id)).rejects.toThrow(TicketNotFoundError);
    const list = await queries.list(asB, { tab: "all" });
    expect(list.data.find((row: any) => row.id === created.id)).toBeUndefined();
  });

  it("người được giao đích danh chỉ thấy ticket hạn chế khi ticket chưa có chủ trì", async () => {
    const created = await restrictedAssigned();
    const asC = actor(IT_C);
    await expect(queries.getById(asC, created.id)).rejects.toThrow(TicketNotFoundError);

    // Chưa có chủ trì: người được giao đích danh thấy
    await commands.assign(boss(), created.id, {
      mode: "members",
      memberIds: [IT_C],
      assignedBy: BOSS
    } as any);
    expect(((await queries.getById(asC, created.id)) as any).accessLevel).toBe("full");

    // Giao lại cho người khác kèm chủ trì: IT_C không còn xem được
    await commands.assign(boss(), created.id, {
      mode: "members",
      memberIds: [IT_A],
      ownerId: IT_A,
      assignedBy: BOSS
    } as any);
    await expect(queries.getById(asC, created.id)).rejects.toThrow(TicketNotFoundError);
  });
});

describe("ticket tạm hoãn không bị kẹt khi mất chủ trì", () => {
  it("chủ trì duy nhất trả lại ticket đang tạm hoãn → về open, xoá thông tin tạm hoãn, người khác nhận được", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.hold(itA(), created.id, { reason: "Chờ ngân hàng" });

    await commands.release(itA(), created.id, "Không làm được");
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("open");
    expect(doc.hold ?? null).toBeNull();
    expect(doc.assignment.owner_id ?? null).toBeNull();

    const asB: any = await queries.getById(itB(), created.id);
    expect(asB.capabilities.claim).toBe(true);
    await commands.claim(itB(), created.id);
    expect(((await TicketModel.findById(created.id).lean()) as any).status).toBe("in_progress");
  });

  it("giao ticket đang tạm hoãn cho phòng ban (không chủ trì) → về open để phòng đó nhận", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.hold(itA(), created.id, { reason: "Chờ dev" });

    await commands.assign(boss(), created.id, {
      mode: "department",
      departmentId: DEPT_IT,
      assignedBy: BOSS
    } as any);
    const doc: any = await TicketModel.findById(created.id).lean();
    expect(doc.status).toBe("open");
    expect(doc.hold ?? null).toBeNull();
    expect(doc.assignment.owner_id ?? null).toBeNull();
  });
});

describe("nhận ticket khi đã có người phối hợp thêm sớm", () => {
  it("người được thêm phối hợp từ trước vẫn nhận được, thành chủ trì và không còn trong danh sách phối hợp", async () => {
    const created = await createPlain();
    await commands.addCollaborator(boss(), created.id, IT_B);

    await commands.claim(itB(), created.id);
    const detail: any = await queries.getById(boss(), created.id);
    expect(detail.assignment.owner.id).toBe(IT_B);
    expect(detail.assignment.collaborators.map((person: any) => person.id)).not.toContain(IT_B);
  });

  it("giao đích danh: giữ người phối hợp thêm sớm; người đã rời nhóm không bị thêm lại", async () => {
    const created = await createPlain();
    await commands.assign(boss(), created.id, {
      mode: "members",
      memberIds: [IT_A, IT_C],
      assignedBy: BOSS
    } as any);
    await commands.addCollaborator(boss(), created.id, IT_B);

    await commands.claim(itA(), created.id);
    const afterClaim: any = await queries.getById(boss(), created.id);
    expect(afterClaim.assignment.collaborators.map((person: any) => person.id).sort()).toEqual(
      [IT_B, IT_C].sort()
    );

    // IT_C rời nhóm rồi chủ trì trả lại: IT_C không bị tự thêm trở lại
    await commands.removeCollaborator(itA(), created.id, IT_C);
    await commands.release(itA(), created.id, "Nhường lại");
    const released: any = await queries.getById(boss(), created.id);
    expect(released.assignment.owner.id).toBe(IT_B);
    expect(released.assignment.members.map((person: any) => person.id)).not.toContain(IT_C);
  });
});

describe("báo xong khi ticket cần tờ trình", () => {
  it("capability resolve chỉ bật sau khi tờ trình được xác nhận hợp lệ", async () => {
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
    expect(((await queries.getById(itA(), created.id)) as any).capabilities.resolve).toBe(false);

    await commands.verifyApproval(itA(), created.id, { valid: true });
    expect(((await queries.getById(itA(), created.id)) as any).capabilities.resolve).toBe(true);
  });
});

describe("ticket hạn chế đã đóng chỉ lộ thông tin chung ở danh sách và tìm kiếm", () => {
  it("người tạo không thấy khách / sản phẩm ở dòng danh sách, tìm kiếm không trả SĐT; người có quyền vẫn thấy", async () => {
    const created = await commands.create(
      requester(),
      {
        title: "Đổi SĐT khách riêng tư",
        productId: ids.product,
        templateId: ids.templatePhone,
        customFields: { new_phone: "0987654321" },
        customer: { phone: "0911222333", name: "Khách kín", appCode: "tikluy" }
      },
      [file("approval_document", "totrinh.pdf")]
    );
    await commands.claim(boss(), created.id);
    await commands.close(boss(), created.id, {
      code: "insufficient_basis",
      note: "Chưa đủ căn cứ"
    });

    const rowFor = async (who: TicketActor) =>
      ((await queries.list(who, { tab: "all" })) as any).data.find(
        (row: any) => row.id === created.id
      );

    const asRequester = await rowFor(requester());
    expect(asRequester.customer).toBeNull();
    expect(asRequester.product.name).toBe("");
    expect(asRequester.owner).toBeNull();
    expect(asRequester.resolution.label).toBe("Chưa đủ cơ sở");
    expect(asRequester.capabilities.reopen).toBe(true);

    const asBoss = await rowFor(boss());
    expect(asBoss.customer.phone).toBe("0911222333");
    expect(asBoss.product.name).toBe("TIKLUY APP");

    const found = await queries.searchTickets(requester(), "khách riêng tư");
    expect(found[0].customerPhone).toBeNull();
    const foundByBoss = await queries.searchTickets(boss(), "khách riêng tư");
    expect(foundByBoss[0].customerPhone).toBe("0911222333");
  });
});

describe("lịch sử trả chữ người đọc được", () => {
  it("thêm/gỡ phối hợp ghi tên người, liên kết ghi mã ticket, giao việc ghi kiểu giao", async () => {
    const created = await createPlain();
    const other = await createPlain({ title: "Ticket khác" });
    await commands.claim(itA(), created.id);
    await commands.addCollaborator(itA(), created.id, IT_B);
    await commands.removeCollaborator(itA(), created.id, IT_B);
    await commands.linkRelated(itA(), created.id, other.id);

    const detail: any = await queries.getById(itA(), created.id);
    const noteOf = (action: string) =>
      detail.activities.find((activity: any) => activity.action === action)?.note;
    expect(noteOf("collaborator_added")).toBe("IT B");
    expect(noteOf("collaborator_removed")).toBe("IT B");
    expect(noteOf("linked")).toBe(other.code);

    await commands.assign(boss(), created.id, {
      mode: "department",
      departmentId: DEPT_IT,
      assignedBy: BOSS
    } as any);
    const afterAssign: any = await queries.getById(boss(), created.id);
    const assigned = afterAssign.activities.filter(
      (activity: any) => activity.action === "assigned"
    );
    expect(assigned[assigned.length - 1].note).toBe("Giao cho phòng ban");
  });
});

describe("tờ trình bổ sung chỉ tính file của chính người tạo", () => {
  it("file tờ trình do người xử lý đăng trong trao đổi không thay được tờ trình của người tạo", async () => {
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
    // createdAt của file do Mongoose đặt bằng đồng hồ thật nên mốc "yêu cầu bổ sung" phải nằm trong quá khứ thật
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30);
    }); // sau file tờ trình lúc tạo ticket
    now = new Date();
    await commands.verifyApproval(itA(), created.id, { valid: false, note: "Thiếu chữ ký" });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30);
    }); // trước các file đăng trong trao đổi

    // IT đăng file loại tờ trình trong trao đổi: không tính là người tạo đã bổ sung
    await commands.addMessage(itA(), created.id, { body: "Đây là mẫu" }, [
      file("approval_document", "mau.pdf")
    ]);
    await expect(commands.submitInfo(requester(), created.id, {})).rejects.toThrow();

    // Người tạo tự gửi file tờ trình trong trao đổi: tính
    await commands.addMessage(requester(), created.id, { body: "Em gửi lại" }, [
      file("approval_document", "moi.pdf")
    ]);
    await commands.submitInfo(requester(), created.id, {});
    expect(((await TicketModel.findById(created.id).lean()) as any).status).toBe("in_progress");
  });
});

describe("cron nhắc không gửi lặp và không nhắc ticket đã đổi trạng thái", () => {
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

  it("hai lần quét chồng nhau chỉ nhắc một lần; version tăng khi đánh dấu đã nhắc", async () => {
    const created = await createPlain();
    await commands.claim(itA(), created.id);
    await commands.requestInfo(itA(), created.id, { items: [{ key: "screenshot" }] });
    const before: any = await TicketModel.findById(created.id).lean();

    const remindClock = new Date(T0.getTime() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
    const [first, second] = await Promise.all([sweepAt(remindClock), sweepAt(remindClock)]);
    expect(first.reminded + second.reminded).toBe(1);
    expect(
      notifier.sent.filter(
        (item) => item.type === "auto_close_reminder" && item.ticketId === created.id
      )
    ).toHaveLength(1);

    const after: any = await TicketModel.findById(created.id).lean();
    expect(after.version).toBe(before.version + 1);
    expect(after.remind_at ?? null).toBeNull();
  });
});
