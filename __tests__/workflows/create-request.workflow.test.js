const mongoose = require("mongoose");
const moment = require("moment-timezone");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const TZ = "Asia/Ho_Chi_Minh";

jest.mock("../../src/modules/request/domain/approval-chain", () => ({
  getApprovalChain: jest.fn()
}));
jest.mock("../../src/helpers/requestUtils", () => {
  const actual = jest.requireActual("../../src/helpers/requestUtils");
  return { ...actual, notify: jest.fn() };
});

const { getApprovalChain } = require("../../src/modules/request/domain/approval-chain");
const { notify } = require("../../src/helpers/requestUtils");
const AccountModel = require("../../src/models/AccountModel");
const UserInfoModel = require("../../src/models/UserInfoModel");
const LeaveBalanceModel = require("../../src/models/LeaveBalanceModel");
const { RequestModel, RemoteRequest, LeaveRequest } = require("../../src/models/RequestModel");
const leaveSideEffects = require("../../src/workflows/request-side-effects/leave");
const { createRequest } = require("../../src/workflows/create-request.workflow");

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await AccountModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  await RequestModel.deleteMany({});
  await LeaveBalanceModel.deleteMany({});
  jest.restoreAllMocks();
  getApprovalChain.mockReset();
  notify.mockReset();
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

// leaveHandler treats Saturday as a half-day (see calcTotalDays in
// requestUtils.js) and Sunday as non-working — advance until we land on a
// plain weekday (Mon-Fri) so total_days/paid_days assertions are
// deterministic regardless of which day the test actually runs on.
//
// Bug tự phát hiện (flaky, không phải regression từ 1.8.6 — port nguyên từ create-request.test.js gốc):
// bản đầu dùng `new Date()` + `.getDay()` (local system timezone) để check cuối tuần nhưng lại
// `.toISOString()` (UTC) để lấy chuỗi ngày — khi máy chạy test ở giờ local buổi sáng sớm tại timezone
// +07 (Asia/Ho_Chi_Minh), UTC vẫn còn ở NGÀY HÔM TRƯỚC, gây lệch 1 ngày giữa ngày đã check-cuối-tuần
// (local) và chuỗi ngày thực trả về (UTC) — có thể vô tình rơi đúng vào Chủ nhật theo cách
// `calcTotalDays` diễn giải (dùng `moment.tz(dateStr, TZ)`, không phải UTC), làm total_days=0 và
// validate() throw 400 thay vì tạo đơn thành công. Sửa bằng cách dùng moment-timezone nhất quán
// Asia/Ho_Chi_Minh cho CẢ 2 bước (check cuối tuần + tạo chuỗi ngày), không trộn local Date với UTC nữa.
function weekdayFromNow(n) {
  let m = moment.tz(TZ).add(n, "days");
  while (m.day() === 0 || m.day() === 6) {
    m = m.add(1, "day");
  }
  return m.format("YYYY-MM-DD");
}

// Port nguyên __tests__/modules/request/create-request.test.js (task 1.8.6) — orchestration (mở
// transaction + dispatch side-effect xuyên module) đã chuyển từ modules/request/application/
// create-request.service.ts sang workflows/create-request.workflow.ts, giữ nguyên toàn bộ assertion.
// Khác biệt duy nhất: spy onCreate giờ nhắm vào workflows/request-side-effects/leave (nơi logic thật
// đang sống) thay vì helpers/leaveHandler (giờ chỉ còn validate/validateAsync).
describe("createRequest() (workflows/create-request.workflow)", () => {
  it("throw ArgumentInvalidException (400) khi request_type không hợp lệ", async () => {
    const { account } = await createUserInfo(1);
    await expect(createRequest(account, { request_type: "not_a_real_type" })).rejects.toMatchObject(
      { statusCode: 400 }
    );
  });

  it("throw NotFoundException (404) khi tài khoản không có hồ sơ nhân viên", async () => {
    const account = await AccountModel.create({
      username: "no-profile",
      password: "x",
      role: "user"
    });
    await expect(
      createRequest(account, {
        request_type: "remote",
        from_date: weekdayFromNow(1),
        to_date: weekdayFromNow(1)
      })
    ).rejects.toMatchObject({ statusCode: 404, message: "Không tìm thấy thông tin nhân viên" });
  });

  it("throw ArgumentInvalidException (400) khi handler.validate() báo lỗi input sai (remote thiếu ngày)", async () => {
    const { account } = await createUserInfo(1);
    await expect(createRequest(account, { request_type: "remote" })).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it("throw ConflictException (409) khi handler.validateAsync() báo trùng lịch (remote overlap)", async () => {
    const { account } = await createUserInfo(1);
    getApprovalChain.mockResolvedValue([]);

    await createRequest(account, {
      request_type: "remote",
      reason: "wfh",
      from_date: weekdayFromNow(5),
      to_date: weekdayFromNow(6)
    });

    await expect(
      createRequest(account, {
        request_type: "remote",
        reason: "wfh",
        from_date: weekdayFromNow(5),
        to_date: weekdayFromNow(5)
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("201: tạo thành công đơn remote (không có onCreate), notify người duyệt gần nhất sau khi commit", async () => {
    const { account } = await createUserInfo(1);
    const reviewerAccountId = new mongoose.Types.ObjectId();
    getApprovalChain.mockResolvedValue([{ accountId: reviewerAccountId }]);

    const entity = await createRequest(account, {
      request_type: "remote",
      reason: "wfh",
      from_date: weekdayFromNow(2),
      to_date: weekdayFromNow(3)
    });

    const doc = await RemoteRequest.findById(entity.id);
    expect(doc).not.toBeNull();
    expect(doc.status).toBe("pending");
    expect(doc.reason).toBe("wfh");

    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe(reviewerAccountId);
    expect(notify.mock.calls[0][1]).toMatchObject({
      type: "remote_created",
      ref_type: "request"
    });
  });

  it("201: không có ai trong approval chain — không throw, không gọi notify", async () => {
    const { account } = await createUserInfo(1);
    getApprovalChain.mockResolvedValue([]);

    const entity = await createRequest(account, {
      request_type: "remote",
      reason: "wfh",
      from_date: weekdayFromNow(8),
      to_date: weekdayFromNow(9)
    });

    expect(entity).toBeTruthy();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("201: đơn nghỉ phép unpaid — không có side-effect trừ ngày phép (paid_days = 0)", async () => {
    const { account } = await createUserInfo(1);
    getApprovalChain.mockResolvedValue([]);

    const entity = await createRequest(account, {
      request_type: "leave",
      reason: "viec gia dinh",
      from_date: weekdayFromNow(2),
      from_period: "morning",
      to_date: weekdayFromNow(2),
      to_period: "afternoon",
      leave_type: "unpaid"
    });

    const doc = await LeaveRequest.findById(entity.id);
    expect(doc.paid_days).toBe(0);
    expect(doc.unpaid_days).toBe(1);

    const ledger = await LeaveBalanceModel.find({ ref_id: entity.id });
    expect(ledger).toHaveLength(0);
  });

  it("201: đơn nghỉ phép paid — onCreate trừ đúng số ngày phép vào LeaveBalanceModel, _id map đúng từ entity.id", async () => {
    const { account, userInfo } = await createUserInfo(1);
    await LeaveBalanceModel.create({
      user_id: userInfo._id,
      amount: 5,
      reason: "hr_manual_adjustment",
      balance_after: 5
    });
    getApprovalChain.mockResolvedValue([]);
    const onCreateSpy = jest.spyOn(leaveSideEffects, "onCreate");

    const entity = await createRequest(account, {
      request_type: "leave",
      reason: "viec gia dinh",
      from_date: weekdayFromNow(2),
      from_period: "morning",
      to_date: weekdayFromNow(2),
      to_period: "afternoon",
      leave_type: "paid"
    });

    const doc = await LeaveRequest.findById(entity.id);
    expect(doc.paid_days).toBe(1);

    expect(onCreateSpy).toHaveBeenCalledTimes(1);
    const [passedRequest] = onCreateSpy.mock.calls[0];
    expect(String(passedRequest._id)).toBe(String(entity.id));

    const ledger = await LeaveBalanceModel.find({
      ref_id: entity.id,
      reason: "leave_request_deduction"
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(-1);
  });

  it("rollback: handler.onCreate trả lỗi -> KHÔNG lưu Request document, throw exception đúng status", async () => {
    const { account } = await createUserInfo(1);
    await LeaveBalanceModel.create({
      user_id: (await UserInfoModel.findOne({ id_account: account._id }))._id,
      amount: 5,
      reason: "hr_manual_adjustment",
      balance_after: 5
    });
    jest
      .spyOn(leaveSideEffects, "onCreate")
      .mockResolvedValue({ status: 400, message: "forced error" });

    await expect(
      createRequest(account, {
        request_type: "leave",
        reason: "viec gia dinh",
        from_date: weekdayFromNow(2),
        from_period: "morning",
        to_date: weekdayFromNow(2),
        to_period: "afternoon",
        leave_type: "paid"
      })
    ).rejects.toMatchObject({ statusCode: 400, message: "forced error" });

    const count = await LeaveRequest.countDocuments({});
    expect(count).toBe(0);
  });
});
