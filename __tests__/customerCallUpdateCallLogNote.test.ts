import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import { updateCallLogNote } from "../src/modules/customer-call/application/update-call-log-note.service";
import { OmicallClient } from "../src/utils/omicallClient";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "../src/core/exceptions/exceptions";
import PermissionRoleModel from "../src/models/PermissionRoleModel";
import PermissionCatalogModel from "../src/models/PermissionCatalogModel";
import DataScopePolicyModel from "../src/models/DataScopePolicyModel";
import EmployeePermissionProfileModel from "../src/models/EmployeePermissionProfileModel";
import CallLogModel from "../src/models/CallLogModel";
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

async function createSale(username: string, fullName: string, maNv: string) {
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
  return { account, employeeId: String(userInfo._id) };
}

async function seedCallLogUpdateNotePermission(employeeId: string) {
  await PermissionCatalogModel.create({
    code: "call_log.update_note",
    module: "crm",
    name: "Sửa ghi chú cuộc gọi",
    entity: "CallLog",
    actionKind: "WRITE",
    supportsFieldScope: false,
    validDataScopePolicies: ["CALL_LOG_SELF_ASSIGNED_NOTE_TEST"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "CALL_LOG_SELF_ASSIGNED_NOTE_TEST",
    entity: "CallLog",
    label: "Chỉ cuộc gọi của chính mình",
    conditionTree: {
      operator: "AND",
      clauses: [
        {
          left: "resource.sale_id",
          operator: "EQ",
          right: { type: "SUBJECT_REF", path: "subject.userId" }
        }
      ]
    }
  });
  const role = await PermissionRoleModel.create({
    name: "Sale CRM (test)",
    code: "CRM_SALE_NOTE_TEST",
    grants: [
      {
        permissionCode: "call_log.update_note",
        dataScopePolicyCode: "CALL_LOG_SELF_ASSIGNED_NOTE_TEST"
      }
    ]
  });
  await EmployeePermissionProfileModel.create({ employeeId, roleIds: [role._id], overrides: [] });
}

function baseCallLog(overrides: Record<string, unknown>) {
  return {
    transaction_id: `tx-${Math.random()}`,
    call_uuid: `uuid-${Math.random()}`,
    direction: "outbound",
    phone_number: "0911111111",
    time_start_call: new Date(),
    note: "",
    ...overrides
  };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([
    PermissionRoleModel.deleteMany({}),
    PermissionCatalogModel.deleteMany({}),
    DataScopePolicyModel.deleteMany({}),
    EmployeePermissionProfileModel.deleteMany({}),
    CallLogModel.deleteMany({}),
    AccountModel.deleteMany({}),
    UserInfoModel.deleteMany({})
  ]);
});

describe("updateCallLogNote (integration, MongoMemoryServer)", () => {
  test("sale trong scope -> gọi Omicall đúng transaction_id + cập nhật note local thành công", async () => {
    const saleA = await createSale("saleNoteA", "Sale Note A", "NV-NOTE-A");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(baseCallLog({ sale_id: saleA.employeeId }));

    const spy = jest.spyOn(OmicallClient.prototype, "updateCallTransaction").mockResolvedValue({});

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await updateCallLogNote(abilityA, String(callLog._id), "Khách quan tâm gói 6 tháng");

    expect(spy).toHaveBeenCalledWith(callLog.transaction_id, {
      note: "Khách quan tâm gói 6 tháng"
    });
    const updated = await CallLogModel.findById(callLog._id);
    expect(updated!.note).toBe("Khách quan tâm gói 6 tháng");
  });

  test("sale ngoài scope (cuộc gọi của sale khác) -> ForbiddenException, KHÔNG gọi Omicall, không đổi note", async () => {
    const saleA = await createSale("saleNoteB", "Sale Note B", "NV-NOTE-B");
    const saleB = await createSale("saleNoteC", "Sale Note C", "NV-NOTE-C");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(
      baseCallLog({ sale_id: saleB.employeeId, note: "note gốc" })
    );

    const spy = jest.spyOn(OmicallClient.prototype, "updateCallTransaction").mockResolvedValue({});

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await expect(updateCallLogNote(abilityA, String(callLog._id), "note lạ")).rejects.toThrow(
      ForbiddenException
    );

    expect(spy).not.toHaveBeenCalled();
    const unchanged = await CallLogModel.findById(callLog._id);
    expect(unchanged!.note).toBe("note gốc");
  });

  test("callLogId không tồn tại -> NotFoundException (không phải Forbidden)", async () => {
    const saleA = await createSale("saleNoteD", "Sale Note D", "NV-NOTE-D");
    await seedCallLogUpdateNotePermission(saleA.employeeId);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(updateCallLogNote(abilityA, fakeId, "note")).rejects.toThrow(NotFoundException);
  });

  test("Omicall API lỗi -> ConflictException, note local GIỮ NGUYÊN (không lưu nửa vời)", async () => {
    const saleA = await createSale("saleNoteE", "Sale Note E", "NV-NOTE-E");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(
      baseCallLog({ sale_id: saleA.employeeId, note: "note cũ" })
    );

    jest
      .spyOn(OmicallClient.prototype, "updateCallTransaction")
      .mockRejectedValue(new Error("Omicall 500"));

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await expect(updateCallLogNote(abilityA, String(callLog._id), "note mới")).rejects.toThrow(
      ConflictException
    );

    const unchanged = await CallLogModel.findById(callLog._id);
    expect(unchanged!.note).toBe("note cũ");
  });
});
