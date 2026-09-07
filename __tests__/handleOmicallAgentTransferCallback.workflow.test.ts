import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { handleOmicallAgentTransferCallback } from "../src/workflows/handle-omicall-agent-transfer-callback.workflow";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import SaleOmicallProfileModel from "../src/models/SaleOmicallProfileModel";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AccountModel = require("../src/models/AccountModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    SaleOmicallProfileModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
});

async function createEmployee(username: string, fullName: string, maNv: string, email: string) {
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

describe("handleOmicallAgentTransferCallback (workflow)", () => {
  test("webhook SUCCESS -> gỡ role CRM_SALE khỏi nhân viên nguồn (giữ role khác nếu có)", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });
    const otherRole = await PermissionRoleModel.create({
      name: "Role khác",
      code: "OTHER_ROLE_TEST",
      grants: []
    });

    const sourceId = await createEmployee("wfSrcA", "Workflow Src A", "NV-WF-A", "src-a@x.test");
    const targetId = await createEmployee("wfTgtA", "Workflow Tgt A", "NV-WF-B", "tgt-a@x.test");

    await EmployeePermissionProfileModel.create({
      employeeId: sourceId,
      roleIds: [crmSaleRole._id, otherRole._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "201",
      sip_password: "pass",
      omicall_email: "src-a@x.test",
      status: "transferring",
      pending_transfer_request_id: "req-wf-1",
      pending_transfer_target_sale_id: targetId
    });

    await handleOmicallAgentTransferCallback({
      requestId: "req-wf-1",
      status: "SUCCESS",
      payload: { fullName: "Workflow Tgt A", phoneNumber: "0900000000", email: "tgt-a@x.test" }
    });

    const profile = await EmployeePermissionProfileModel.findOne({ employeeId: sourceId }).lean();
    const remainingRoleIds = (profile as any).roleIds.map((id: any) => String(id));
    expect(remainingRoleIds).toEqual([String(otherRole._id)]);
  });

  test("webhook ERROR -> KHÔNG gỡ role của nhân viên nguồn", async () => {
    const crmSaleRole = await PermissionRoleModel.create({
      name: "Sale CRM",
      code: "CRM_SALE",
      grants: []
    });

    const sourceId = await createEmployee("wfSrcB", "Workflow Src B", "NV-WF-C", "src-b@x.test");
    const targetId = await createEmployee("wfTgtB", "Workflow Tgt B", "NV-WF-D", "tgt-b@x.test");

    await EmployeePermissionProfileModel.create({
      employeeId: sourceId,
      roleIds: [crmSaleRole._id],
      overrides: []
    });
    await SaleOmicallProfileModel.create({
      sale_id: sourceId,
      sip_realm: "realm",
      omicall_extension: "202",
      sip_password: "pass",
      omicall_email: "src-b@x.test",
      status: "transferring",
      pending_transfer_request_id: "req-wf-2",
      pending_transfer_target_sale_id: targetId
    });

    await handleOmicallAgentTransferCallback({
      requestId: "req-wf-2",
      status: "ERROR",
      payload: { fullName: "Workflow Tgt B", phoneNumber: "0900000000", email: "tgt-b@x.test" }
    });

    const profile = await EmployeePermissionProfileModel.findOne({ employeeId: sourceId }).lean();
    expect((profile as any).roleIds.map((id: any) => String(id))).toEqual([
      String(crmSaleRole._id)
    ]);
  });
});
