const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

jest.mock("../../src/helpers/rbac", () => ({
  can: jest.fn(),
  getAccountsWithPermission: jest.fn().mockResolvedValue([])
}));
jest.mock("../../src/modules/request/domain/approval-chain", () => ({
  getApprovalChain: jest.fn()
}));
jest.mock("../../src/helpers/requestUtils", () => {
  const actual = jest.requireActual("../../src/helpers/requestUtils");
  return { ...actual, notify: jest.fn() };
});

const { can } = require("../../src/helpers/rbac");
const { getApprovalChain } = require("../../src/modules/request/domain/approval-chain");
const { notify } = require("../../src/helpers/requestUtils");
const AccountModel = require("../../src/models/AccountModel");
const UserInfoModel = require("../../src/models/UserInfoModel");
const {
  ExplanationRequest,
  LeaveRequest,
  ForgotCheckinRequest
} = require("../../src/models/RequestModel");
const leaveSideEffects = require("../../src/workflows/request-side-effects/leave");
const forgotCheckinSideEffects = require("../../src/workflows/request-side-effects/forgot-checkin");
const { RequestEntity } = require("../../src/modules/request/domain/request.entity");
const {
  RequestRepository
} = require("../../src/modules/request/infrastructure/request.repository");
const { reviewRequest } = require("../../src/workflows/review-request.workflow");
const { RequestContextService } = require("../../src/core/context/request-context");

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
  await ExplanationRequest.deleteMany({});
  await LeaveRequest.deleteMany({});
  await ForgotCheckinRequest.deleteMany({});
  jest.restoreAllMocks();
  can.mockReset();
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

async function insertEntity(entity) {
  await RequestContextService.run({ requestId: "setup" }, () => repo.insert(entity));
}

function newExplanationEntity(userId) {
  return RequestEntity.create({
    userId,
    requestType: "explanation",
    reason: "test",
    date: new Date("2026-01-05"),
    content: "quen chấm công"
  });
}

function newLongLeaveEntity(userId) {
  return RequestEntity.create({
    userId,
    requestType: "leave",
    reason: "test",
    from_date: new Date("2026-01-05"),
    from_period: "morning",
    to_date: new Date("2026-01-10"),
    to_period: "afternoon",
    total_days: 4,
    leave_type: "paid",
    paid_days: 4,
    unpaid_days: 0
  });
}

function newMultiApprovalForgotCheckinEntity(userId) {
  // occurrence >= 6 -> needsMultiApproval() === true, và thuộc LEVEL1_FIRST_TYPES
  return RequestEntity.create({
    userId,
    requestType: "forgot_checkin",
    reason: "test",
    date: new Date("2026-01-05"),
    type: "check_in",
    expected_check_in: new Date("2026-01-05T08:00:00Z"),
    expected_check_out: new Date("2026-01-05T17:00:00Z"),
    occurrence: 6
  });
}

// Port nguyên __tests__/modules/request/review-request.test.js (task 1.8.6) — orchestration (acquire
// lock + mở transaction + dispatch side-effect xuyên module) đã chuyển từ modules/request/application/
// review-request.service.ts sang workflows/review-request.workflow.ts, giữ nguyên toàn bộ assertion.
// Khác biệt duy nhất: spy onApprove/onReject giờ nhắm vào workflows/request-side-effects/leave và
// forgot-checkin (nơi logic thật đang sống) thay vì helpers/leaveHandler/forgotCheckinHandler (giờ chỉ
// còn validate/validateAsync).
describe("reviewRequest() (workflows/review-request.workflow)", () => {
  it("throw ArgumentInvalidException (400) khi id không hợp lệ", async () => {
    const { account } = await createUserInfo(1);
    await expect(
      reviewRequest(account, "not-an-object-id", { action: "approve" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throw ArgumentInvalidException (400) khi action không hợp lệ", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newExplanationEntity(owner._id);
    await insertEntity(entity);

    await expect(
      reviewRequest(account, entity.id, { action: "not_a_real_action" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throw NotFoundException (404) khi tài khoản không có hồ sơ nhân viên", async () => {
    const account = await AccountModel.create({
      username: "no-profile",
      password: "x",
      role: "user"
    });
    const { userInfo: owner } = await createUserInfo(1);
    const entity = newExplanationEntity(owner._id);
    await insertEntity(entity);

    await expect(reviewRequest(account, entity.id, { action: "approve" })).rejects.toMatchObject({
      statusCode: 404,
      message: "Không tìm thấy thông tin nhân viên"
    });
  });

  it("throw NotFoundException (404) khi đơn không tồn tại", async () => {
    const { account } = await createUserInfo(1);
    await expect(
      reviewRequest(account, new mongoose.Types.ObjectId().toString(), { action: "approve" })
    ).rejects.toMatchObject({ statusCode: 404, message: "Đơn không tồn tại" });
  });

  it("throw ForbiddenException (403) khi không canReviewAll và không trong chuỗi duyệt", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newExplanationEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(false);
    getApprovalChain.mockResolvedValue([]);

    await expect(reviewRequest(account, entity.id, { action: "approve" })).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it("throw CannotSelfReviewError (403) khi tự duyệt đơn của mình", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const entity = newExplanationEntity(userInfo._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);

    await expect(reviewRequest(account, entity.id, { action: "approve" })).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it("throw InvalidStatusTransitionError (409) khi đơn không còn pending", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newExplanationEntity(owner._id);
    entity.approve(new mongoose.Types.ObjectId().toString(), "");
    await insertEntity(entity);

    can.mockResolvedValue(true);

    await expect(reviewRequest(account, entity.id, { action: "approve" })).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it("200: approve đơn 1-người-duyệt — isFinal=true, status=approved", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newExplanationEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);

    const result = await reviewRequest(account, entity.id, {
      action: "approve",
      reviewer_note: "ok"
    });

    expect(result.isFinal).toBe(true);
    expect(result.entity.status).toBe("approved");

    const doc = await ExplanationRequest.findById(entity.id);
    expect(doc.status).toBe("approved");
    expect(doc.reviewer_note).toBe("ok");
  });

  it("200: reject đơn 1-người-duyệt — isFinal=true, status=rejected", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newExplanationEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);

    const result = await reviewRequest(account, entity.id, { action: "reject" });

    expect(result.isFinal).toBe(true);
    expect(result.entity.status).toBe("rejected");
  });

  it("200: đơn đa duyệt (leave total_days>3) — lần approve ĐẦU không finalize, KHÔNG gọi handler.onApprove", async () => {
    const { account: r1 } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newLongLeaveEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);
    const onApproveSpy = jest.spyOn(leaveSideEffects, "onApprove");

    const result = await reviewRequest(r1, entity.id, { action: "approve" });

    expect(result.isFinal).toBe(false);
    expect(result.entity.status).toBe("pending");
    expect(result.entity.approvals).toHaveLength(1);
    expect(onApproveSpy).not.toHaveBeenCalled();
  });

  it("200: đơn đa duyệt — lần approve THỨ 2 (reviewer khác) mới finalize, gọi handler.onApprove với _id map đúng", async () => {
    const { account: r1 } = await createUserInfo(1);
    const { account: r2 } = await createUserInfo(2);
    const { userInfo: owner } = await createUserInfo(3);
    const entity = newLongLeaveEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);
    const onApproveSpy = jest.spyOn(leaveSideEffects, "onApprove").mockResolvedValue(undefined);

    await reviewRequest(r1, entity.id, { action: "approve" });
    const result = await reviewRequest(r2, entity.id, { action: "approve" });

    expect(result.isFinal).toBe(true);
    expect(result.entity.status).toBe("approved");
    expect(result.entity.approvals).toHaveLength(2);
    expect(onApproveSpy).toHaveBeenCalledTimes(1);
    const [passedRequest] = onApproveSpy.mock.calls[0];
    expect(String(passedRequest._id)).toBe(String(entity.id));
  });

  it("throw AlreadyReviewedError (409) khi cùng 1 reviewer approve 2 lần đơn đa duyệt", async () => {
    const { account: r1 } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newLongLeaveEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);

    await reviewRequest(r1, entity.id, { action: "approve" });
    await expect(reviewRequest(r1, entity.id, { action: "approve" })).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it("reject đơn đã duyệt 1/2 — vẫn cho phép (veto-1-người), approvals KHÔNG bị xoá, handler.onReject nhận đúng request", async () => {
    const { account: r1 } = await createUserInfo(1);
    const { account: r2 } = await createUserInfo(2);
    const { userInfo: owner } = await createUserInfo(3);
    const entity = newLongLeaveEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);
    const onRejectSpy = jest.spyOn(leaveSideEffects, "onReject").mockResolvedValue(undefined);

    await reviewRequest(r1, entity.id, { action: "approve" });
    const result = await reviewRequest(r2, entity.id, { action: "reject" });

    expect(result.isFinal).toBe(true);
    expect(result.entity.status).toBe("rejected");
    expect(result.entity.approvals).toHaveLength(1);
    expect(onRejectSpy).toHaveBeenCalledTimes(1);
  });

  it("notify: thông báo 1/2 khi duyệt partial, gửi cho chủ đơn", async () => {
    const { account: r1 } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const entity = newLongLeaveEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);

    await reviewRequest(r1, entity.id, { action: "approve" });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0][0])).toBe(String(owner.id_account));
    expect(notify.mock.calls[0][1]).toMatchObject({ type: "leave_partially_approved" });
  });

  it("notify: khi reject đè lên approval đã có, message có nhắc tới việc đã duyệt 1 phần trước đó", async () => {
    const { account: r1 } = await createUserInfo(1);
    const { account: r2 } = await createUserInfo(2);
    const { userInfo: owner } = await createUserInfo(3);
    const entity = newLongLeaveEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);
    getApprovalChain.mockResolvedValue([]);
    jest.spyOn(leaveSideEffects, "onReject").mockResolvedValue(undefined);

    await reviewRequest(r1, entity.id, { action: "approve" });
    await reviewRequest(r2, entity.id, { action: "reject" });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    // 2 notify call đi tới chủ đơn: 1/2 lúc approve đầu, và lúc reject sau —
    // lấy đúng call thuộc action reject (type kết thúc bằng "_rejected").
    const rejectNotifyCall = notify.mock.calls.find(
      (call) => String(call[0]) === String(owner.id_account) && call[1].type.endsWith("_rejected")
    );
    expect(rejectNotifyCall[1].body).toMatch(/duyệt 1 phần trước đó/);
  });

  it("2 reviewer approve đồng thời đơn đa duyệt (Redis lock serialize) — cả 2 đều thành công, không ConflictException, approvals đủ 2, đúng 1 lần finalize", async () => {
    const { account: r1 } = await createUserInfo(1);
    const { account: r2 } = await createUserInfo(2);
    const { userInfo: owner } = await createUserInfo(3);
    const entity = newLongLeaveEntity(owner._id);
    await insertEntity(entity);

    can.mockResolvedValue(true);
    jest.spyOn(leaveSideEffects, "onApprove").mockResolvedValue(undefined);

    const [res1, res2] = await Promise.all([
      reviewRequest(r1, entity.id, { action: "approve" }),
      reviewRequest(r2, entity.id, { action: "approve" })
    ]);

    const finalized = [res1, res2].filter((r) => r.isFinal);
    expect(finalized).toHaveLength(1);
    expect(finalized[0].entity.status).toBe("approved");
    expect(finalized[0].entity.approvals).toHaveLength(2);
  });

  // Người dùng chốt qua hỏi trực tiếp: KHÔNG ràng buộc thứ tự duyệt giữa 2 cấp — ai trong chain
  // duyệt trước cũng được, kể cả forgot_checkin/late_early (trước đây có rule "trưởng bộ phận
  // (chain[0]) phải duyệt trước", đã bỏ hẳn — leave vốn dĩ chưa từng bị ràng buộc này).
  describe("đơn đa cấp: không ràng buộc thứ tự duyệt giữa cấp 1 và cấp 2", () => {
    it("200: chain[1] (gián tiếp) duyệt lần đầu dù chain[0] (trực tiếp) chưa duyệt — vẫn được phép, isFinal=false", async () => {
      const { account: r1 } = await createUserInfo(1);
      const { account: r2 } = await createUserInfo(2);
      const { userInfo: owner } = await createUserInfo(3);
      const entity = newMultiApprovalForgotCheckinEntity(owner._id);
      await insertEntity(entity);

      can.mockResolvedValue(false);
      getApprovalChain.mockResolvedValue([{ accountId: r1._id }, { accountId: r2._id }]);

      const result = await reviewRequest(r2, entity.id, { action: "approve" });

      expect(result.isFinal).toBe(false);
      expect(result.entity.approvals).toHaveLength(1);
    });

    it("200: chain[1] duyệt trước, sau đó chain[0] duyệt tiếp — hoàn tất đủ 2 cấp bất kể thứ tự", async () => {
      const { account: r1 } = await createUserInfo(1);
      const { account: r2 } = await createUserInfo(2);
      const { userInfo: owner } = await createUserInfo(3);
      const entity = newMultiApprovalForgotCheckinEntity(owner._id);
      await insertEntity(entity);

      can.mockResolvedValue(false);
      getApprovalChain.mockResolvedValue([{ accountId: r1._id }, { accountId: r2._id }]);
      jest.spyOn(forgotCheckinSideEffects, "onApprove").mockResolvedValue(undefined);

      await reviewRequest(r2, entity.id, { action: "approve" });
      const result = await reviewRequest(r1, entity.id, { action: "approve" });

      expect(result.isFinal).toBe(true);
      expect(result.entity.status).toBe("approved");
      expect(result.entity.approvals).toHaveLength(2);
    });

    it("200: canReviewAll=true vẫn duyệt được lần đầu dù không nằm trong chain", async () => {
      const { account: r2 } = await createUserInfo(2);
      const { userInfo: owner } = await createUserInfo(3);
      const entity = newMultiApprovalForgotCheckinEntity(owner._id);
      await insertEntity(entity);

      can.mockResolvedValue(true);

      const result = await reviewRequest(r2, entity.id, { action: "approve" });

      expect(result.isFinal).toBe(false);
      expect(result.entity.approvals).toHaveLength(1);
    });
  });
});
