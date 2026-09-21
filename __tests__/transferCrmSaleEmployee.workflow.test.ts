import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { transferCrmSaleEmployee } from "../src/workflows/transfer-crm-sale-employee.workflow";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import CustomerModel from "../src/models/CustomerModel";
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
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    CustomerModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
});

async function createEmployee(username: string, fullName: string, maNv: string) {
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
    employment_type: "fulltime"
  });
  return String(userInfo._id);
}

async function grantCrmSaleRole(employeeId: string, roleCode: string) {
  let role = await PermissionRoleModel.findOne({ code: roleCode });
  if (!role) {
    role = await PermissionRoleModel.create({ name: roleCode, code: roleCode, grants: [] });
  }
  await EmployeePermissionProfileModel.create({
    employeeId,
    roleIds: [role._id],
    overrides: []
  });
}

describe("transferCrmSaleEmployee", () => {
  test("chuyển thành công -> đổi referred_by của đúng khách hàng thuộc nguồn, không đụng khách người khác", async () => {
    const sourceId = await createEmployee("tfSrcA", "Transfer Src A", "NV-TF-A");
    const targetId = await createEmployee("tfTgtA", "Transfer Tgt A", "NV-TF-B");
    const otherId = await createEmployee("tfOtherA", "Transfer Other A", "NV-TF-C");
    await grantCrmSaleRole(sourceId, "CRM_SALE");
    await grantCrmSaleRole(targetId, "CRM_SALE_MANAGER");

    const appId = new mongoose.Types.ObjectId();
    const customer1 = await CustomerModel.create({
      app_id: appId,
      phone_number: "0911111111",
      referred_by: sourceId,
      source_type: "sale"
    });
    const customer2 = await CustomerModel.create({
      app_id: appId,
      phone_number: "0922222222",
      referred_by: otherId,
      source_type: "sale"
    });

    const result = await transferCrmSaleEmployee(sourceId, targetId);
    expect(result).toEqual({ reassignedCustomerCount: 1 });

    const updatedCustomer1 = await CustomerModel.findById(customer1._id).lean();
    expect(String((updatedCustomer1 as any).referred_by)).toBe(targetId);

    const updatedCustomer2 = await CustomerModel.findById(customer2._id).lean();
    expect(String((updatedCustomer2 as any).referred_by)).toBe(otherId);
  });

  test("nguồn = đích -> ArgumentInvalidException", async () => {
    const sourceId = await createEmployee("tfSrcB", "Transfer Src B", "NV-TF-D");
    await grantCrmSaleRole(sourceId, "CRM_SALE");

    await expect(transferCrmSaleEmployee(sourceId, sourceId)).rejects.toMatchObject({
      statusCode: 400
    });
  });

  test("nguồn không có role Sale CRM -> NotFoundException", async () => {
    const sourceId = await createEmployee("tfSrcC", "Transfer Src C", "NV-TF-E");
    const targetId = await createEmployee("tfTgtC", "Transfer Tgt C", "NV-TF-F");
    await grantCrmSaleRole(targetId, "CRM_SALE");

    await expect(transferCrmSaleEmployee(sourceId, targetId)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test("đích không có role Sale CRM hợp lệ -> NotFoundException", async () => {
    const sourceId = await createEmployee("tfSrcD", "Transfer Src D", "NV-TF-G");
    const targetId = await createEmployee("tfTgtD", "Transfer Tgt D", "NV-TF-H");
    await grantCrmSaleRole(sourceId, "CRM_SALE");

    await expect(transferCrmSaleEmployee(sourceId, targetId)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  test("nguồn không có khách hàng nào -> reassignedCustomerCount = 0, không lỗi", async () => {
    const sourceId = await createEmployee("tfSrcE", "Transfer Src E", "NV-TF-I");
    const targetId = await createEmployee("tfTgtE", "Transfer Tgt E", "NV-TF-J");
    await grantCrmSaleRole(sourceId, "CRM_SALE");
    await grantCrmSaleRole(targetId, "CRM_SALE");

    const result = await transferCrmSaleEmployee(sourceId, targetId);
    expect(result).toEqual({ reassignedCustomerCount: 0 });
  });
});
