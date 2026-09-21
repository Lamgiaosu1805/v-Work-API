import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { resolveEffectiveAbility } from "../src/modules/permission/application/resolve-effective-ability.service";
import { rateCallLog } from "../src/modules/customer-call/application/rate-call-log.service";
import { CallLogRepository } from "../src/modules/customer-call/infrastructure/call-log.repository";
import {
  ArgumentInvalidException,
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
    validDataScopePolicies: ["CALL_LOG_SELF_ASSIGNED_RATING_TEST"],
    validFieldScopePolicies: []
  });
  await DataScopePolicyModel.create({
    code: "CALL_LOG_SELF_ASSIGNED_RATING_TEST",
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
    code: "CRM_SALE_RATING_TEST",
    grants: [
      {
        permissionCode: "call_log.update_note",
        dataScopePolicyCode: "CALL_LOG_SELF_ASSIGNED_RATING_TEST"
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

describe("rateCallLog (integration, MongoMemoryServer)", () => {
  test("sale trong scope -> lưu rating + note thành công", async () => {
    const saleA = await createSale("saleRateA", "Sale Rate A", "NV-RATE-A");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(baseCallLog({ sale_id: saleA.employeeId }));

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await rateCallLog(abilityA, String(callLog._id), 5, "Khách rất hài lòng");

    const updated = await CallLogModel.findById(callLog._id);
    expect(updated!.rating).toBe(5);
    expect(updated!.note).toBe("Khách rất hài lòng");
  });

  test("chỉ gửi rating, không kèm note -> note giữ nguyên", async () => {
    const saleA = await createSale("saleRateB", "Sale Rate B", "NV-RATE-B");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(
      baseCallLog({ sale_id: saleA.employeeId, note: "note cũ" })
    );

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await rateCallLog(abilityA, String(callLog._id), 3);

    const updated = await CallLogModel.findById(callLog._id);
    expect(updated!.rating).toBe(3);
    expect(updated!.note).toBe("note cũ");
  });

  test("rating ngoài khoảng 1-5 -> ArgumentInvalidException, không đổi gì", async () => {
    const saleA = await createSale("saleRateC", "Sale Rate C", "NV-RATE-C");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(baseCallLog({ sale_id: saleA.employeeId }));

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await expect(rateCallLog(abilityA, String(callLog._id), 6)).rejects.toThrow(
      ArgumentInvalidException
    );

    const unchanged = await CallLogModel.findById(callLog._id);
    expect(unchanged!.rating).toBeNull();
  });

  test("sale ngoài scope (cuộc gọi của sale khác) -> ForbiddenException, không đổi rating", async () => {
    const saleA = await createSale("saleRateD", "Sale Rate D", "NV-RATE-D");
    const saleB = await createSale("saleRateE", "Sale Rate E", "NV-RATE-E");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(baseCallLog({ sale_id: saleB.employeeId }));

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await expect(rateCallLog(abilityA, String(callLog._id), 4)).rejects.toThrow(ForbiddenException);

    const unchanged = await CallLogModel.findById(callLog._id);
    expect(unchanged!.rating).toBeNull();
  });

  test("callLogId không tồn tại -> NotFoundException", async () => {
    const saleA = await createSale("saleRateF", "Sale Rate F", "NV-RATE-F");
    await seedCallLogUpdateNotePermission(saleA.employeeId);

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(rateCallLog(abilityA, fakeId, 4)).rejects.toThrow(NotFoundException);
  });

  test("đánh giá lại (rate lần 2) không bị webhook applyWebhookPayload xoá mất", async () => {
    const saleA = await createSale("saleRateG", "Sale Rate G", "NV-RATE-G");
    await seedCallLogUpdateNotePermission(saleA.employeeId);
    const callLog = await CallLogModel.create(baseCallLog({ sale_id: saleA.employeeId }));

    const abilityA = await resolveEffectiveAbility(saleA.employeeId);
    await rateCallLog(abilityA, String(callLog._id), 4);

    // Giả lập webhook Omicall đồng bộ lại (vd cập nhật duration/hangup_cause muộn) — rating phải KHÔNG bị mất
    const repo = new CallLogRepository();
    const entity = (await repo.findOneById(String(callLog._id)))!;
    entity.applyWebhookPayload({
      transactionId: entity.transactionId,
      callUuid: "uuid-resync",
      direction: "outbound",
      phoneNumber: "0911111111",
      hotline: "",
      fromNumber: "",
      toNumber: "",
      sipUser: "",
      saleId: saleA.employeeId,
      customerId: null,
      answerSec: 10,
      billSec: 10,
      duration: 20,
      callOutPrice: 0,
      timeStartCall: new Date(),
      timeRingingStart: null,
      timeAnswerStart: null,
      timeEndCall: new Date(),
      hangupCause: "NORMAL_CLEARING",
      recordingFileUrl: "",
      recordSeconds: 0,
      note: entity.note,
      tag: [],
      rawPayload: null
    });
    await repo.updateById(entity.id, entity);

    const afterResync = await CallLogModel.findById(callLog._id);
    expect(afterResync!.rating).toBe(4);
  });
});
