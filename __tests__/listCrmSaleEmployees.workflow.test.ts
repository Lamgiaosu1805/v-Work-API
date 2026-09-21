import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { listCrmSaleEmployees } from "../src/workflows/list-crm-sale-employees.workflow";
import { OmicallClient } from "../src/utils/omicallClient";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
});

async function createSale(username: string, fullName: string, maNv: string, email: string) {
  const account = await AccountModel.create({ username, password: "x" });
  const userInfo = await UserInfoModel.create({
    full_name: fullName,
    cccd: `${maNv}-cccd`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1990-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: maNv,
    employment_type: "fulltime",
    email
  });
  return String(userInfo._id);
}

function mockSearchAgents(items: any[]) {
  jest.spyOn(OmicallClient.prototype, "searchAgents").mockResolvedValue({
    items,
    page_number: 1,
    page_size: 50,
    total_items: items.length,
    total_pages: 1,
    has_next: false,
    has_previous: false
  });
}

describe("listCrmSaleEmployees (integration, MongoMemoryServer + mock OmicallClient)", () => {
  test("agent trên Omicall khớp extension + active -> omicallSyncStatus synced", async () => {
    const role = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale("empA", "Emp A", "NV-A", "a@omicall.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "a@omicall.test"
    });

    mockSearchAgents([
      {
        id: "agent-1",
        email: "a@omicall.test",
        full_name: "Emp A",
        is_active: true,
        pbx_account: { sip_user: "101", sip_password: "pass" }
      }
    ]);

    const result = await listCrmSaleEmployees();
    expect(result.find((e) => e.employeeId === employeeId)?.omicallSyncStatus).toBe("synced");
  });

  test("agent trên Omicall khác mật khẩu local -> omicallSyncStatus mismatch", async () => {
    const role = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale("empG", "Emp G", "NV-G", "g@omicall.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass-old",
      omicall_email: "g@omicall.test"
    });

    mockSearchAgents([
      {
        id: "agent-7",
        email: "g@omicall.test",
        full_name: "Emp G",
        is_active: true,
        pbx_account: { sip_user: "101", sip_password: "pass-new" }
      }
    ]);

    const result = await listCrmSaleEmployees();
    expect(result.find((e) => e.employeeId === employeeId)?.omicallSyncStatus).toBe("mismatch");
  });

  test("agent trên Omicall khác extension local -> omicallSyncStatus mismatch", async () => {
    const role = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale("empB", "Emp B", "NV-B", "b@omicall.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "b@omicall.test"
    });

    mockSearchAgents([
      {
        id: "agent-2",
        email: "b@omicall.test",
        full_name: "Emp B",
        is_active: true,
        pbx_account: { sip_user: "999", sip_password: "x" }
      }
    ]);

    const result = await listCrmSaleEmployees();
    expect(result.find((e) => e.employeeId === employeeId)?.omicallSyncStatus).toBe("mismatch");
  });

  test("agent trên Omicall is_active = false -> omicallSyncStatus inactive", async () => {
    const role = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale("empC", "Emp C", "NV-C", "c@omicall.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "c@omicall.test"
    });

    mockSearchAgents([
      {
        id: "agent-3",
        email: "c@omicall.test",
        full_name: "Emp C",
        is_active: false,
        pbx_account: { sip_user: "101", sip_password: "x" }
      }
    ]);

    const result = await listCrmSaleEmployees();
    expect(result.find((e) => e.employeeId === employeeId)?.omicallSyncStatus).toBe("inactive");
  });

  test("không tìm thấy agent trên Omicall theo email -> omicallSyncStatus not_found", async () => {
    const role = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale("empD", "Emp D", "NV-D", "d@omicall.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "d@omicall.test"
    });

    mockSearchAgents([]);

    const result = await listCrmSaleEmployees();
    expect(result.find((e) => e.employeeId === employeeId)?.omicallSyncStatus).toBe("not_found");
  });

  test("nhân viên chưa từng đồng bộ (chưa có SaleOmicallProfile) -> omicallSyncStatus null", async () => {
    const role = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale("empE", "Emp E", "NV-E", "e@omicall.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: []
    });

    mockSearchAgents([]);

    const result = await listCrmSaleEmployees();
    expect(result.find((e) => e.employeeId === employeeId)?.omicallSyncStatus).toBeNull();
  });

  test("gọi Omicall lỗi -> vẫn trả list bình thường, omicallSyncStatus rơi về not_found cho nhân viên đã đồng bộ", async () => {
    const role = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const employeeId = await createSale("empF", "Emp F", "NV-F", "f@omicall.test");
    await EmployeePermissionProfileModel.create({
      employeeId,
      roleIds: [role._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "f@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "searchAgents").mockRejectedValue(new Error("network"));

    const result = await listCrmSaleEmployees();
    expect(result.find((e) => e.employeeId === employeeId)?.omicallSyncStatus).toBe("not_found");
  });
});
