const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

jest.mock("../../../src/helpers/rbac", () => ({ can: jest.fn() }));
jest.mock("../../../src/modules/request/domain/approval-chain", () => ({
  getApprovalChain: jest.fn(),
  getManagedUserIds: jest.fn()
}));

const { can } = require("../../../src/helpers/rbac");
const { getApprovalChain } = require("../../../src/modules/request/domain/approval-chain");
const UserInfoModel = require("../../../src/models/UserInfoModel");
const AccountModel = require("../../../src/models/AccountModel");
const { LeaveRequest } = require("../../../src/models/RequestModel");
const {
  getRequestById
} = require("../../../src/modules/request/application/get-request-by-id.service");

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await UserInfoModel.deleteMany({});
  await AccountModel.deleteMany({});
  await LeaveRequest.deleteMany({});
  jest.clearAllMocks();
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

function leaveRequestPayload(userId, overrides = {}) {
  return {
    user_id: userId,
    reason: "test",
    from_date: new Date("2026-01-05"),
    from_period: "morning",
    to_date: new Date("2026-01-05"),
    to_period: "afternoon",
    total_days: 1,
    leave_type: "paid",
    ...overrides
  };
}

describe("getRequestById()", () => {
  it("throw ArgumentInvalidException (400) khi id không phải ObjectId hợp lệ", async () => {
    const { account } = await createUserInfo(1);
    await expect(getRequestById(account, "not-an-object-id")).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it("throw NotFoundException (404) khi đơn không tồn tại", async () => {
    const { account } = await createUserInfo(1);
    can.mockResolvedValue(false);
    await expect(
      getRequestById(account, new mongoose.Types.ObjectId().toString())
    ).rejects.toMatchObject({ statusCode: 404, message: "Đơn không tồn tại" });
  });

  it("owner luôn xem được đơn của chính mình, không cần permission gì", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const doc = await LeaveRequest.create(leaveRequestPayload(userInfo._id));
    can.mockResolvedValue(false);
    getApprovalChain.mockResolvedValue([]);

    const data = await getRequestById(account, String(doc._id));
    expect(String(data.user_id._id)).toBe(String(userInfo._id));
  });

  it("canViewAll=true xem được đơn của người khác", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const doc = await LeaveRequest.create(leaveRequestPayload(owner._id));
    can.mockResolvedValueOnce(true);
    getApprovalChain.mockResolvedValue([]);

    const data = await getRequestById(account, String(doc._id));
    expect(String(data.user_id._id)).toBe(String(owner._id));
  });

  it("403: không phải owner, không canViewAll, không canReview", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const doc = await LeaveRequest.create(leaveRequestPayload(owner._id));
    can.mockResolvedValue(false);

    await expect(getRequestById(account, String(doc._id))).rejects.toMatchObject({
      statusCode: 403,
      message: "Bạn không có quyền xem đơn này"
    });
  });

  it("403: canReview=true nhưng KHÔNG nằm trong approval chain của chủ đơn", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const doc = await LeaveRequest.create(leaveRequestPayload(owner._id));
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    getApprovalChain.mockResolvedValue([{ accountId: new mongoose.Types.ObjectId() }]);

    await expect(getRequestById(account, String(doc._id))).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it("200: canReview=true VÀ nằm trong approval chain của chủ đơn", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const doc = await LeaveRequest.create(leaveRequestPayload(owner._id));
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    getApprovalChain.mockResolvedValue([{ accountId: account._id }]);

    const data = await getRequestById(account, String(doc._id));
    expect(String(data.user_id._id)).toBe(String(owner._id));
  });

  it("pending_reviewer: null khi status khác 'pending'", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const doc = await LeaveRequest.create(
      leaveRequestPayload(userInfo._id, { status: "cancelled" })
    );
    can.mockResolvedValue(false);

    const data = await getRequestById(account, String(doc._id));
    expect(data.pending_reviewer).toBeNull();
    expect(getApprovalChain).not.toHaveBeenCalled();
  });

  it("pending_reviewer: người đầu tiên trong chain chưa approve", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const reviewerA = new mongoose.Types.ObjectId();
    const reviewerB = new mongoose.Types.ObjectId();
    const doc = await LeaveRequest.create(
      leaveRequestPayload(userInfo._id, {
        status: "pending",
        approvals: [{ account: reviewerA, reviewed_at: new Date() }]
      })
    );
    can.mockResolvedValue(true);
    getApprovalChain.mockResolvedValue([{ accountId: reviewerA }, { accountId: reviewerB }]);

    const data = await getRequestById(account, String(doc._id));
    expect(String(data.pending_reviewer.accountId)).toBe(String(reviewerB));
  });

  it("getApprovalChain chỉ gọi 1 lần dù cả nhánh canSee VÀ pending_reviewer đều cần dùng (memoize đúng)", async () => {
    const { account } = await createUserInfo(1);
    const { userInfo: owner } = await createUserInfo(2);
    const doc = await LeaveRequest.create(
      leaveRequestPayload(owner._id, { status: "pending", approvals: [] })
    );
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    getApprovalChain.mockResolvedValue([{ accountId: account._id }]);

    await getRequestById(account, String(doc._id));

    expect(getApprovalChain).toHaveBeenCalledTimes(1);
  });

  it("approvals được enrich kèm reviewer profile (resolveReviewerProfileByAccountId thật, không mock)", async () => {
    const { account, userInfo } = await createUserInfo(1);
    const { account: reviewerAccount } = await createUserInfo(2);
    const doc = await LeaveRequest.create(
      leaveRequestPayload(userInfo._id, {
        approvals: [{ account: reviewerAccount._id, reviewed_at: new Date() }]
      })
    );
    can.mockResolvedValue(false);

    const data = await getRequestById(account, String(doc._id));
    expect(data.approvals).toHaveLength(1);
    expect(data.approvals[0].reviewer.full_name).toBe("NV 2");
  });
});
