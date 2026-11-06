jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import { execFile } from "child_process";
import path from "path";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import UserInfoModel from "../src/models/UserInfoModel";
import {
  computeTicketAccess,
  createHandbookPersonalContext
} from "../src/workflows/handbook-personal-context.workflow";
import {
  buildPrompt,
  formatPersonalContext,
  formatTicketAccess,
  SYSTEM_PROMPT,
  TICKET_ACCESS_LABEL
} from "../src/modules/handbook-assistant/infrastructure/ai/prompt-builder";
import type { TicketAccess } from "../src/modules/handbook-assistant";
/* eslint-enable import/first */

const NONE: TicketAccess = {
  canCreate: false,
  canView: false,
  canHandle: false,
  canAssignDepartment: false,
  canAssignMember: false,
  canManage: false,
  canViewRestricted: false,
  canViewSensitive: false,
  canConfig: false
};

describe("computeTicketAccess (hàm thuần)", () => {
  const can =
    (...granted: string[]) =>
    (action: string) =>
      granted.includes(action);

  it("không có quyền nào → tất cả cờ false", () => {
    expect(computeTicketAccess(can())).toEqual(NONE);
  });

  it("mỗi quyền ticket chỉ bật đúng cờ của nó (ticket.manage KHÔNG kéo theo ticket.handle)", () => {
    expect(computeTicketAccess(can("ticket.manage"))).toEqual({ ...NONE, canManage: true });
    expect(computeTicketAccess(can("ticket.handle"))).toEqual({ ...NONE, canHandle: true });
    expect(computeTicketAccess(can("ticket.config"))).toEqual({ ...NONE, canConfig: true });
    expect(computeTicketAccess(can("ticket.assign_member"))).toEqual({
      ...NONE,
      canAssignMember: true
    });
  });

  it("quyền CRM không làm đổi quyền ticket (ticket chỉ ở Workplace, không còn cờ riêng cho CRM)", () => {
    expect(computeTicketAccess(can("customer.view"))).toEqual(NONE);
    expect(computeTicketAccess(can("customer_claim_request.create"))).toEqual(NONE);
  });
});

describe("dòng quyền Ticket trong khối dữ liệu cá nhân", () => {
  const FULL: TicketAccess = { ...NONE, canCreate: true, canView: true };

  it("không có ticketAccess (cổng không tra) → khối giữ nguyên như cũ, không nhắc tới ticket", () => {
    const block = formatPersonalContext({ leaveBalanceDays: 8 }) as string;
    expect(block).not.toContain(TICKET_ACCESS_LABEL);
    expect(block).toBe(formatPersonalContext({ leaveBalanceDays: 8, ticketAccess: undefined }));
  });

  it("có quyền → một dòng đủ 9 mục, có/không rõ ràng, không lộ mã quyền", () => {
    const block = formatPersonalContext({ leaveBalanceDays: 8, ticketAccess: FULL }) as string;
    expect(block).toContain(`- ${TICKET_ACCESS_LABEL}: `);
    expect(block).toContain("tạo ticket: có");
    expect(block).toContain("nhận và xử lý ticket: không");
    expect(block).not.toContain("CRM");
    expect(block.split("\n")).toHaveLength(3);
    expect(block).not.toMatch(/ticket\.(handle|create|manage)/);
  });

  it("tra lỗi (null) → nói rõ chưa tra được, KHÔNG in ra có/không", () => {
    const line = formatTicketAccess(null);
    expect(line).toMatch(/chưa tra được lúc này/);
    expect(line).not.toMatch(/có|không/);
  });

  it("dòng quyền chỉ nằm ở tin user HIỆN TẠI, không bao giờ trong phần được cache dùng chung", () => {
    const article = {
      documentCode: "HDT",
      documentTitle: "Hướng dẫn ticket",
      articleIdx: 1,
      label: "Mục 1",
      title: "Mục 1",
      chapter: "",
      blocks: ["x"]
    };
    const base = { articles: [article], cacheTtl: "1h" as const, history: [], question: "Q" };
    const a = buildPrompt({ ...base, personal: { leaveBalanceDays: 1, ticketAccess: FULL } });
    const b = buildPrompt({
      ...base,
      personal: { leaveBalanceDays: 9, ticketAccess: { ...FULL, canHandle: true } }
    });
    const cacheable = (prompt: ReturnType<typeof buildPrompt>) =>
      JSON.stringify(
        (prompt.messages[0].content as any[]).filter((block) => block.type === "document")
      );
    expect(cacheable(a)).toBe(cacheable(b));
    expect(JSON.stringify(a.messages)).toContain("tạo ticket: có");
    // prefix có cache_control không chứa chữ nào về quyền cá nhân
    const cached = (a.messages[0].content as any[]).find((block) => block.cache_control);
    expect(JSON.stringify(cached)).not.toContain(TICKET_ACCESS_LABEL);
  });

  it("system prompt có quy tắc 10: theo dòng quyền, không nêu mã quyền, chỉ của chính người hỏi", () => {
    expect(SYSTEM_PROMPT).toContain(`"${TICKET_ACCESS_LABEL}"`);
    expect(SYSTEM_PROMPT).toMatch(/10\. Quyền Ticket hỗ trợ của người hỏi/);
    expect(SYSTEM_PROMPT).toMatch(/không nêu mã quyền/);
    expect(SYSTEM_PROMPT).toMatch(/không suy ra hay nêu quyền của người khác/);
    expect(SYSTEM_PROMPT).toMatch(/không dựa vào lời tự nhận chức vụ/);
  });
});

// KIỂM THỬ VỚI PHÂN QUYỀN THẬT: chạy đúng các script seed role lên Mongo in-memory, gán role cho nhân viên như
// ngoài thực tế rồi hỏi cổng thật `createHandbookPersonalContext` — chứng minh từng người nhận đúng quyền của
// CHÍNH họ (không lẫn của người khác).
describe("createHandbookPersonalContext với role seed thật", () => {
  const SCRIPTS = [
    "seedPermissionCatalog.ts",
    "seedPermissionDataScopePolicy.ts",
    "seedPermissionEntityAttributeCatalog.ts",
    "seedPermissionEmployeeBaselineRole.ts",
    "seedPermissionCrmRoles.ts",
    "seedPermissionDeptLeadRole.ts",
    "seedPermissionCompanyExecutiveRole.ts",
    "seedPermissionTicketRoles.ts"
  ];
  const run = (file: string, uri: string) =>
    new Promise<void>((resolve, reject) => {
      execFile(
        "node",
        ["-r", "ts-node/register/transpile-only", path.join(__dirname, "../scripts", file)],
        {
          cwd: path.join(__dirname, ".."),
          env: { ...process.env, MONGODB_URI: uri },
          timeout: 180000
        },
        (error, stdout, stderr) =>
          error ? reject(new Error(`${file} lỗi: ${stdout}\n${stderr}`)) : resolve()
      );
    });

  let replset: MongoMemoryReplSet;
  const people: Record<string, string> = {};

  async function makePerson(key: string, roleCodes: string[]) {
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
    const roles = await PermissionRoleModel.find({
      code: { $in: roleCodes },
      isDeleted: false
    }).lean();
    expect(roles.map((role: any) => role.code).sort()).toEqual([...roleCodes].sort());
    await EmployeePermissionProfileModel.create({
      employeeId: user._id,
      roleIds: roles.map((role: any) => role._id)
    });
    people[key] = String(user._id);
  }

  const accessOf = async (key: string) =>
    (await createHandbookPersonalContext().getForAsker({ accountId: "a", userInfoId: people[key] }))
      .ticketAccess as TicketAccess;

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replset.getUri();
    await mongoose.connect(uri);
    for (const script of SCRIPTS) {
      // eslint-disable-next-line no-await-in-loop
      await run(script, uri);
    }
    const BASE = "EMPLOYEE_BASELINE";
    await makePerson("employee", [BASE]);
    await makePerson("sale", [BASE, "CRM_SALE"]);
    await makePerson("itStaff", [BASE, "WORKPLACE_TICKET_STAFF"]);
    await makePerson("itManager", [BASE, "WORKPLACE_TICKET_MANAGER"]);
    await makePerson("accountant", [BASE, "WORKPLACE_TICKET_HANDLER"]);
    await makePerson("deptLead", [BASE, "DEPT_LEAD"]);
    await makePerson("exec", [BASE, "COMPANY_EXECUTIVE"]);
    await makePerson("nobody", []);
  }, 600000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replset.stop();
  });

  it("nhân viên thường: tạo + xem; không nhận / xử lý / giao / cấu hình", async () => {
    expect(await accessOf("employee")).toEqual({ ...NONE, canCreate: true, canView: true });
  });

  it("sale có role CRM: quyền ticket vẫn như nhân viên thường (CRM không thêm quyền ticket)", async () => {
    expect(await accessOf("sale")).toEqual({ ...NONE, canCreate: true, canView: true });
  });

  it("nhân viên hỗ trợ ticket (IT): nhận / xử lý, giao phòng, xem ticket hạn chế và file nhạy cảm; không cấu hình", async () => {
    expect(await accessOf("itStaff")).toMatchObject({
      canCreate: true,
      canHandle: true,
      canAssignDepartment: true,
      canViewRestricted: true,
      canViewSensitive: true,
      canManage: false,
      canConfig: false
    });
  });

  it("quản lý ticket: thêm đóng hộ, giao trong phòng và cấu hình", async () => {
    expect(await accessOf("itManager")).toMatchObject({
      canHandle: true,
      canManage: true,
      canAssignMember: true,
      canConfig: true
    });
  });

  it("người xử lý ở đơn vị khác (kế toán): chỉ thêm nhận / xử lý, không xem file nhạy cảm, không giao phòng", async () => {
    expect(await accessOf("accountant")).toEqual({
      ...NONE,
      canCreate: true,
      canView: true,
      canHandle: true
    });
  });

  it("trưởng bộ phận: giao cho người trong phòng, không nhận / xử lý", async () => {
    expect(await accessOf("deptLead")).toMatchObject({
      canAssignMember: true,
      canAssignDepartment: false,
      canHandle: false
    });
  });

  it("ban lãnh đạo: quản lý + giao cả phòng + xem hạn chế / nhạy cảm nhưng KHÔNG có quyền nhận (handle)", async () => {
    expect(await accessOf("exec")).toMatchObject({
      canManage: true,
      canAssignDepartment: true,
      canAssignMember: true,
      canViewRestricted: true,
      canViewSensitive: true,
      canHandle: false
    });
  });

  it("không có role nào → không có quyền nào (không tạo được), và mỗi người chỉ nhận quyền của chính mình", async () => {
    expect(await accessOf("nobody")).toEqual(NONE);
    expect(await accessOf("employee")).not.toEqual(await accessOf("itStaff"));
  });

  it("nhân viên không tồn tại / lỗi tra quyền → null (chưa tra được), không phải 'không có quyền'", async () => {
    const provider = createHandbookPersonalContext(() => Promise.reject(new Error("redis down")));
    const result = await provider.getForAsker({ accountId: "a", userInfoId: people.itStaff });
    expect(result.ticketAccess).toBeNull();
  });
});
