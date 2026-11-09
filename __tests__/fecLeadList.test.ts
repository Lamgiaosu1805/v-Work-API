import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as XLSX from "xlsx";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import { exportFecLeadsForViewer } from "../src/workflows/export-fec-leads.workflow";
import {
  getFecLeadHistoryForViewer,
  listFecLeadsForViewer
} from "../src/workflows/list-fec-leads.workflow";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import FecLeadModel from "../src/models/FecLeadModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AppModel = require("../src/models/AppModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CustomerModel = require("../src/models/CustomerModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DataExportLogModel = require("../src/models/DataExportLogModel");

let mongod: MongoMemoryServer;
let abilitySaleA: any;
let abilityManager: any;

async function createEmployee(username: string, maNv: string) {
  const account = await AccountModel.create({ username, password: "x" });
  return UserInfoModel.create({
    full_name: `Sale ${maNv}`,
    cccd: `${maNv}-cccd`,
    phone_number: "0900000001",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
}

async function grantCustomerView(employeeId: unknown, policyCode: string, roleCode: string) {
  const role = await PermissionRoleModel.create({
    name: roleCode,
    code: roleCode,
    grants: [{ permissionCode: "customer.view", dataScopePolicyCode: policyCode }]
  });
  await EmployeePermissionProfileModel.create({
    employeeId,
    roleIds: [role._id],
    overrides: []
  });
}

const lead = (
  id: string,
  customerId: unknown,
  stage: string,
  extra: Record<string, unknown> = {}
) => ({
  app_code: "vnfite",
  partner: "FEC",
  customer_id: customerId,
  customer_external_id: `ext-${id}`,
  lead_gen_id: id,
  trans_id: `T-${id}`,
  lead_status: "OK",
  lead_created_at: new Date("2026-10-10T03:00:00Z"),
  stage,
  version: 2,
  last_event_at: new Date("2026-10-11T03:00:00Z"),
  last_event_id: `evt-${id}`,
  history: [],
  ...extra
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const saleA = await createEmployee("sale_a", "A001");
  const saleB = await createEmployee("sale_b", "B001");
  const manager = await createEmployee("mgr", "M001");

  await PermissionCatalogModel.create({
    code: "customer.view",
    module: "crm",
    name: "customer.view",
    entity: "Customer",
    actionKind: "READ",
    supportsFieldScope: false,
    validDataScopePolicies: ["CUSTOMER_SELF_ASSIGNED", "CUSTOMER_ALL_COMPANY"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "CUSTOMER_SELF_ASSIGNED",
    entity: "Customer",
    label: "Khách do mình phụ trách",
    conditionTree: {
      operator: "AND",
      clauses: [
        {
          left: "resource.referred_by",
          operator: "EQ",
          right: { type: "SUBJECT_REF", path: "subject.userId" }
        }
      ]
    }
  });
  await DataScopePolicyModel.create({
    code: "CUSTOMER_ALL_COMPANY",
    entity: "Customer",
    label: "Toàn công ty",
    conditionTree: null
  });
  await grantCustomerView(saleA._id, "CUSTOMER_SELF_ASSIGNED", "FEC_TEST_SALE_A");
  await grantCustomerView(manager._id, "CUSTOMER_ALL_COMPANY", "FEC_TEST_MANAGER");
  abilitySaleA = await resolveEffectiveAbility(String(saleA._id));
  abilityManager = await resolveEffectiveAbility(String(manager._id));

  const vnfite = await AppModel.create({ name: "VNFITE", code: "vnfite" });

  const custA = await CustomerModel.create({
    app_id: vnfite._id,
    phone_number: "0911111111",
    external_id: "u-a",
    referred_by: saleA._id,
    source_type: "sale",
    identity: { full_name: "Nguyen Van An" }
  });
  const custB = await CustomerModel.create({
    app_id: vnfite._id,
    phone_number: "0922222222",
    external_id: "u-b",
    referred_by: saleB._id,
    source_type: "sale",
    identity: { full_name: "Tran Thi Binh" }
  });

  await FecLeadModel.create([
    lead("LEAD-A1", custA._id, "FOLLOW_UP", { last_step: "App Download" }),
    lead("LEAD-A2", custA._id, "COMPLETED", {
      offer_amt: 50000000,
      cash_amt: 48000000,
      history: [
        {
          callback_id: "c2",
          status: "PL Disbursed",
          received_at: new Date("2026-10-12T03:00:00Z")
        },
        {
          callback_id: "c1",
          status: "Pending Offer",
          received_at: new Date("2026-10-11T03:00:00Z")
        }
      ]
    }),
    lead("LEAD-B1", custB._id, "IN_PROGRESS")
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Danh sách khách FE Credit", () => {
  it("Sale chỉ thấy lead của khách mình phụ trách, đếm theo giai đoạn cũng chỉ trong phạm vi", async () => {
    const result = await listFecLeadsForViewer(abilitySaleA, { appCode: "vnfite" });

    expect(result.data.map((item) => item.lead_gen_id).sort()).toEqual(["LEAD-A1", "LEAD-A2"]);
    expect(result.total).toBe(2);
    expect(result.counts).toEqual({
      FOLLOW_UP: 1,
      IN_PROGRESS: 0,
      COMPLETED: 1,
      STOPPED: 0,
      REJECTED_AT_START: 0
    });
  });

  it("Quản lý toàn công ty thấy tất cả và có kèm tên khách, Sale phụ trách", async () => {
    const result = await listFecLeadsForViewer(abilityManager, { appCode: "vnfite" });

    expect(result.total).toBe(3);
    const b1 = result.data.find((item) => item.lead_gen_id === "LEAD-B1");
    expect(b1?.customer?.full_name).toBe("Tran Thi Binh");
    expect(b1?.customer?.phone_number).toBe("0922222222");
    expect(b1?.sale?.ma_nv).toBe("B001");
  });

  it("lọc theo giai đoạn và tìm theo tên, SĐT, mã hồ sơ", async () => {
    const byBucket = await listFecLeadsForViewer(abilityManager, {
      appCode: "vnfite",
      bucket: "COMPLETED"
    });
    expect(byBucket.data.map((item) => item.lead_gen_id)).toEqual(["LEAD-A2"]);
    expect(byBucket.total).toBe(1);

    const byName = await listFecLeadsForViewer(abilityManager, {
      appCode: "vnfite",
      q: "tran thi"
    });
    expect(byName.data.map((item) => item.lead_gen_id)).toEqual(["LEAD-B1"]);

    const byPhone = await listFecLeadsForViewer(abilityManager, { appCode: "vnfite", q: "0911" });
    expect(byPhone.data.map((item) => item.lead_gen_id).sort()).toEqual(["LEAD-A1", "LEAD-A2"]);

    const byLeadId = await listFecLeadsForViewer(abilityManager, {
      appCode: "vnfite",
      q: "LEAD-B1"
    });
    expect(byLeadId.data.map((item) => item.lead_gen_id)).toEqual(["LEAD-B1"]);
  });

  it("ký tự đặc biệt trong từ khoá không làm hỏng truy vấn", async () => {
    const result = await listFecLeadsForViewer(abilityManager, { appCode: "vnfite", q: ".*(" });
    expect(result.total).toBe(0);
  });

  it("giai đoạn lạ bị bỏ qua thay vì làm lỗi, phân trang tính đúng", async () => {
    const result = await listFecLeadsForViewer(abilityManager, {
      appCode: "vnfite",
      bucket: "KHONG_CO",
      limit: 2
    });
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(2);
    expect(result.total_pages).toBe(2);
  });

  it("app không tồn tại thì 404", async () => {
    await expect(listFecLeadsForViewer(abilityManager, { appCode: "khong-co" })).rejects.toThrow(
      "Không tìm thấy app"
    );
  });
});

describe("Lịch sử hồ sơ FE Credit", () => {
  it("trả lịch sử theo thứ tự thời gian cho người trong phạm vi", async () => {
    const result = await getFecLeadHistoryForViewer(abilitySaleA, "LEAD-A2");

    expect(result.lead.lead_gen_id).toBe("LEAD-A2");
    expect(result.history.map((h) => h.status)).toEqual(["Pending Offer", "PL Disbursed"]);
  });

  it("Sale không xem được lịch sử lead của khách người khác", async () => {
    await expect(getFecLeadHistoryForViewer(abilitySaleA, "LEAD-B1")).rejects.toThrow(
      "Bạn không có quyền xem hồ sơ này"
    );
  });

  it("404 khi không có hồ sơ", async () => {
    await expect(getFecLeadHistoryForViewer(abilityManager, "LEAD-KHONG-CO")).rejects.toThrow(
      "Không tìm thấy hồ sơ FE Credit"
    );
  });
});

describe("Nhãn bước và gợi ý cho Sale", () => {
  it("danh sách kèm nhãn bước + gợi ý, lịch sử kèm nhãn trạng thái", async () => {
    const list = await listFecLeadsForViewer(abilityManager, { appCode: "vnfite" });
    const a1 = list.data.find((item) => item.lead_gen_id === "LEAD-A1");
    expect(a1?.step_label).toBe("Đã tải app FE Credit");
    expect(a1?.advice).toContain("chưa đăng ký");

    const history = await getFecLeadHistoryForViewer(abilityManager, "LEAD-A2");
    expect(history.history.map((h) => h.status_label)).toEqual([
      "Chờ khách xác nhận đề nghị",
      "Đã giải ngân"
    ]);
  });
});

describe("Xuất Excel khách FE Credit", () => {
  const exportAs = (ability: any, extra: Record<string, unknown> = {}) =>
    exportFecLeadsForViewer(ability, {
      appCode: "vnfite",
      accountId: new mongoose.Types.ObjectId(),
      ip: "127.0.0.1",
      userAgent: "jest",
      ...extra
    });

  const readRows = (buffer: Buffer) => {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Khách FE Credit"]);
  };

  it("quản lý xuất đủ các hồ sơ, có nhãn tiếng Việt và ghi nhật ký xuất dữ liệu", async () => {
    const before = await DataExportLogModel.countDocuments({ resource: "fec_lead" });
    const { buffer, filename } = await exportAs(abilityManager);

    expect(filename).toMatch(/^khach_fe_credit_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const rows = readRows(buffer);
    expect(rows).toHaveLength(3);
    const a2 = rows.find((row) => row["Mã hồ sơ"] === "LEAD-A2");
    expect(a2?.["Giai đoạn"]).toBe("Hoàn tất");
    expect(a2?.["Giải ngân"]).toBe(48000000);
    expect(a2?.["Họ tên"]).toBe("Nguyen Van An");
    expect(a2?.["Mã NV"]).toBe("A001");

    expect(await DataExportLogModel.countDocuments({ resource: "fec_lead" })).toBe(before + 1);
    const log = await DataExportLogModel.findOne({ resource: "fec_lead" }).sort({ createdAt: -1 });
    expect(log.row_count).toBe(3);
    expect(log.filters.app_code).toBe("vnfite");
  });

  it("Sale chỉ xuất được hồ sơ của khách mình phụ trách", async () => {
    const { buffer } = await exportAs(abilitySaleA);
    expect(
      readRows(buffer)
        .map((row) => row["Mã hồ sơ"])
        .sort()
    ).toEqual(["LEAD-A1", "LEAD-A2"]);
  });

  it("xuất theo đúng nhóm đang xem và từ khoá", async () => {
    const { buffer } = await exportAs(abilityManager, { bucket: "IN_PROGRESS" });
    expect(readRows(buffer).map((row) => row["Mã hồ sơ"])).toEqual(["LEAD-B1"]);
  });

  it("không có dữ liệu khớp thì báo lỗi và không ghi nhật ký", async () => {
    const before = await DataExportLogModel.countDocuments({ resource: "fec_lead" });
    await expect(exportAs(abilityManager, { q: "khong-khop-gi-het" })).rejects.toThrow(
      "Không có dữ liệu khớp bộ lọc để xuất"
    );
    expect(await DataExportLogModel.countDocuments({ resource: "fec_lead" })).toBe(before);
  });

  it("không giới hạn số dòng: xuất đủ hơn 2.000 hồ sơ (qua nhiều lô), STT liên tục và không trùng", async () => {
    const customer = await CustomerModel.findOne({ external_id: "u-a" });
    const bulk = Array.from({ length: 2500 }, (_, i) =>
      lead(`BULK-${String(i).padStart(4, "0")}`, customer._id, "FOLLOW_UP")
    );
    await FecLeadModel.insertMany(bulk);
    try {
      const { buffer } = await exportAs(abilityManager);
      const rows = readRows(buffer);
      expect(rows).toHaveLength(2503);
      expect(new Set(rows.map((row) => row["Mã hồ sơ"])).size).toBe(2503);
      expect(rows.map((row) => row.STT)).toEqual(Array.from({ length: 2503 }, (_, i) => i + 1));
      expect(
        rows.every((row) => row["Họ tên"] === "Nguyen Van An" || row["Họ tên"] === "Tran Thi Binh")
      ).toBe(true);
    } finally {
      await FecLeadModel.deleteMany({ lead_gen_id: /^BULK-/ });
    }
  });
});
