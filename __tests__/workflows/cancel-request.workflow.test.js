const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const AccountModel = require("../../src/models/AccountModel");
const UserInfoModel = require("../../src/models/UserInfoModel");
const LeaveBalanceModel = require("../../src/models/LeaveBalanceModel");
const { LeaveRequest, RemoteRequest } = require("../../src/models/RequestModel");
const { RequestEntity } = require("../../src/modules/request/domain/request.entity");
const {
  RequestRepository
} = require("../../src/modules/request/infrastructure/request.repository");
const { cancelRequest } = require("../../src/workflows/cancel-request.workflow");
const { RequestContextService } = require("../../src/core/context/request-context");
const leaveSideEffects = require("../../src/workflows/request-side-effects/leave");

let mongod;
let repo;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
  repo = new RequestRepository();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await AccountModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  await LeaveRequest.deleteMany({});
  await LeaveBalanceModel.deleteMany({});
  jest.restoreAllMocks();
});

async function createUserInfo(n) {
  const account = await AccountModel.create({ username: `acc${n}`, password: "x", role: "user" });
  const userInfo = await UserInfoModel.create({
    full_name: `NV ${n}`,
    cccd: `${n}`.padStart(12, "0"),
    phone_number: `090${n}`.padEnd(10, "0"),
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: account._id,
    ma_nv: `NV${n}`,
    employment_type: "fulltime"
  });
  return { account, userInfo };
}

function newLeaveEntity(userId, overrides = {}) {
  return RequestEntity.create({
    userId,
    requestType: "leave",
    reason: "test",
    from_date: new Date("2026-01-05"),
    from_period: "morning",
    to_date: new Date("2026-01-05"),
    to_period: "afternoon",
    total_days: 1,
    leave_type: "paid",
    paid_days: 1,
    unpaid_days: 0,
    ...overrides
  });
}

async function insertEntity(entity) {
  await RequestContextService.run({ requestId: "setup" }, () => repo.insert(entity));
}

// Port nguyên __tests__/modules/request/cancel-request.test.js (task 1.8.6) — orchestration (mở
// transaction + dispatch side-effect xuyên module) đã chuyển từ modules/request/application/
// cancel-request.service.ts sang workflows/cancel-request.workflow.ts, giữ nguyên toàn bộ assertion.
// Khác biệt duy nhất: spy onReject giờ nhắm vào workflows/request-side-effects/leave thay vì
// helpers/leaveHandler (giờ chỉ còn validate/validateAsync).
describe("cancelRequest() (workflows/cancel-request.workflow)", () => {
  it("throw ArgumentInvalidException (400) khi id không hợp lệ", async () => {
    const { account } = await createUserInfo(1);
    await expect(cancelRequest(account, "not-an-object-id")).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it("throw NotFoundException (404) khi đơn không tồn tại", async () => {
    const { account } = await createUserInfo(1);
    await expect(
      cancelRequest(account, new mongoose.Types.ObjectId().toString())
    ).rejects.toMatchObject({ statusCode: 404, message: "Đơn không tồn tại" });
  });

  it("throw NotFoundException (404) khi tài khoản không có hồ sơ nhân viên", async () => {
    const { userInfo: owner } = await createUserInfo(1);
    const entity = newLeaveEntity(owner._id);
    await insertEntity(entity);
    const noProfileAccount = await AccountModel.create({
      username: "no-profile",
      password: "x",
      role: "user"
    });

    await expect(cancelRequest(noProfileAccount, entity.id)).rejects.toMatchObject({
      statusCode: 404,
      message: "Không tìm thấy thông tin nhân viên"
    });
  });

  it("throw ForbiddenException (403) khi không phải chủ đơn", async () => {
    const { userInfo: owner } = await createUserInfo(1);
    const { account: other } = await createUserInfo(2);
    const entity = newLeaveEntity(owner._id);
    await insertEntity(entity);

    await expect(cancelRequest(other, entity.id)).rejects.toMatchObject({
      statusCode: 403,
      message: "Bạn không phải chủ đơn này, không thể hủy"
    });
  });

  it("throw InvalidStatusTransitionError (409) khi đơn không còn pending", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const entity = newLeaveEntity(userInfo._id, { status: "approved" });
    await insertEntity(entity);

    await expect(cancelRequest(account, entity.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("200: huỷ thành công, status chuyển thành cancelled, gọi đúng handler.onReject với _id map từ entity.id", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const entity = newLeaveEntity(userInfo._id, { paid_days: 2 });
    await insertEntity(entity);

    const onRejectSpy = jest.spyOn(leaveSideEffects, "onReject");

    await cancelRequest(account, entity.id);

    const doc = await LeaveRequest.findById(entity.id);
    expect(doc.status).toBe("cancelled");

    expect(onRejectSpy).toHaveBeenCalledTimes(1);
    const [passedRequest, , isCancel] = onRejectSpy.mock.calls[0];
    expect(String(passedRequest._id)).toBe(String(entity.id));
    expect(passedRequest.paid_days).toBe(2);
    expect(isCancel).toBe(true);

    const ledger = await LeaveBalanceModel.find({ ref_id: entity.id });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(2);
  });

  it("200: loại đơn không có handler.onReject (vd remote) vẫn huỷ được bình thường", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const entity = RequestEntity.create({
      userId: userInfo._id,
      requestType: "remote",
      reason: "wfh",
      from_date: new Date("2026-01-06"),
      to_date: new Date("2026-01-06"),
      total_days: 1
    });
    await insertEntity(entity);

    await cancelRequest(account, entity.id);

    const doc = await RemoteRequest.findById(entity.id);
    expect(doc.status).toBe("cancelled");
  });

  it("race: 2 lần cancel đồng thời cùng 1 đơn — 1 thành công, 1 nhận ConflictException (409) sạch", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const entity = newLeaveEntity(userInfo._id);
    await insertEntity(entity);

    const results = await RequestContextService.run({ requestId: "race-test" }, () =>
      Promise.allSettled([cancelRequest(account, entity.id), cancelRequest(account, entity.id)])
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected").reason;
    expect(loser.statusCode).toBe(409);

    const ledger = await LeaveBalanceModel.find({ ref_id: entity.id });
    expect(ledger).toHaveLength(1);
  });
});
