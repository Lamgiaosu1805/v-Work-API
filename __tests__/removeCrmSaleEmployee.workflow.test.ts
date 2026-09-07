import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { removeCrmSaleEmployee } from "../src/workflows/remove-crm-sale-employee.workflow";
import { OmicallClient } from "../src/utils/omicallClient";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
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
  return { account, employeeId: String(userInfo._id) };
}

describe("removeCrmSaleEmployee (integration, MongoMemoryServer)", () => {
  test("gỡ nhân viên -> gọi deleteAgent Omicall, bỏ role CRM_SALE (giữ role khác), soft-delete SaleOmicallProfile, xoá email", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const otherRole = await PermissionRoleModel.create({
      name: "Role khác không phải CRM",
      code: "OTHER_ROLE_TEST",
      grants: []
    });

    const sale = await createSale("removeSaleA", "Remove Sale A", "NV-REMOVE-A", "a@omicall.test");

    await EmployeePermissionProfileModel.create({
      employeeId: sale.employeeId,
      roleIds: [crmSaleRole._id, otherRole._id],
      overrides: []
    });

    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "101",
      sip_password: "pass",
      omicall_email: "a@omicall.test"
    });

    const deleteAgentSpy = jest.spyOn(OmicallClient.prototype, "deleteAgent").mockResolvedValue({});

    await removeCrmSaleEmployee(sale.employeeId);

    expect(deleteAgentSpy).toHaveBeenCalledWith("a@omicall.test");

    const profile = await EmployeePermissionProfileModel.findOne({
      employeeId: sale.employeeId
    }).lean();
    const remainingRoleIds = (profile as any).roleIds.map((id: any) => String(id));
    expect(remainingRoleIds).toEqual([String(otherRole._id)]);

    const omicallProfile = await SaleOmicallProfileModel.findOne({
      sale_id: sale.employeeId
    }).lean();
    expect((omicallProfile as any).isDeleted).toBe(true);

    const userInfo = await UserInfoModel.findById(sale.employeeId).lean();
    expect((userInfo as any).email).toBeNull();
  });

  test("deleteAgent Omicall lỗi -> ném ConflictException, KHÔNG gỡ role/profile/email local", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });

    const sale = await createSale("removeSaleB", "Remove Sale B", "NV-REMOVE-B", "b@omicall.test");

    await EmployeePermissionProfileModel.create({
      employeeId: sale.employeeId,
      roleIds: [crmSaleRole._id],
      overrides: []
    });

    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "102",
      sip_password: "pass",
      omicall_email: "b@omicall.test"
    });

    jest.spyOn(OmicallClient.prototype, "deleteAgent").mockRejectedValue({
      response: { data: { message: "Agent không tồn tại" } },
      message: "Request failed with status code 404"
    });

    await expect(removeCrmSaleEmployee(sale.employeeId)).rejects.toMatchObject({
      statusCode: 409,
      message: "Xóa tài khoản Omicall thất bại: Agent không tồn tại"
    });

    const profile = await EmployeePermissionProfileModel.findOne({
      employeeId: sale.employeeId
    }).lean();
    expect((profile as any).roleIds.map((id: any) => String(id))).toEqual([
      String(crmSaleRole._id)
    ]);

    const omicallProfile = await SaleOmicallProfileModel.findOne({
      sale_id: sale.employeeId
    }).lean();
    expect((omicallProfile as any).isDeleted).toBe(false);

    const userInfo = await UserInfoModel.findById(sale.employeeId).lean();
    expect((userInfo as any).email).toBe("b@omicall.test");
  });

  test("profile đang status transferring -> ném ConflictException, không gọi Omicall, không đổi gì", async () => {
    const sale = await createSale("removeSaleC", "Remove Sale C", "NV-REMOVE-C", "c@omicall.test");

    await SaleOmicallProfileModel.create({
      sale_id: sale.employeeId,
      sip_realm: "realm",
      omicall_extension: "103",
      sip_password: "pass",
      omicall_email: "c@omicall.test",
      status: "transferring",
      pending_transfer_request_id: "req-xyz",
      pending_transfer_target_sale_id: new mongoose.Types.ObjectId().toString()
    });

    const deleteAgentSpy = jest.spyOn(OmicallClient.prototype, "deleteAgent");

    await expect(removeCrmSaleEmployee(sale.employeeId)).rejects.toMatchObject({
      statusCode: 409
    });
    expect(deleteAgentSpy).not.toHaveBeenCalled();

    const omicallProfile = await SaleOmicallProfileModel.findOne({
      sale_id: sale.employeeId
    }).lean();
    expect((omicallProfile as any).isDeleted).toBe(false);
    expect((omicallProfile as any).status).toBe("transferring");
  });
});
