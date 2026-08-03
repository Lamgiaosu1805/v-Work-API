const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

jest.mock("../../../src/modules/request/domain/approval-chain", () => ({
  getApprovalChain: jest.fn()
}));

const { getApprovalChain } = require("../../../src/modules/request/domain/approval-chain");
const UserInfoModel = require("../../../src/models/UserInfoModel");
const AccountModel = require("../../../src/models/AccountModel");
const {
  getEligibleReviewers
} = require("../../../src/modules/request/application/get-eligible-reviewers.service");

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
  getApprovalChain.mockReset();
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

// Yêu cầu nghiệp vụ mới: luồng phê duyệt phải hiển thị đủ cả 2 cấp (trực tiếp + gián tiếp), không
// chỉ cấp 1 như trước (getEligibleReviewers() cũ trả `chain[0] ?? null`).
describe("getEligibleReviewers() — trả đủ cả 2 cấp phê duyệt", () => {
  it("trả về nguyên cả chain (cấp 1 + cấp 2), không chỉ người đầu tiên", async () => {
    const { account } = await createUserInfo(1);
    const level1 = { accountId: new mongoose.Types.ObjectId(), full_name: "Quản lý trực tiếp" };
    const level2 = { accountId: new mongoose.Types.ObjectId(), full_name: "Quản lý gián tiếp" };
    getApprovalChain.mockResolvedValue([level1, level2]);

    const result = await getEligibleReviewers(account._id);

    expect(result).toHaveLength(2);
    expect(String(result[0].accountId)).toBe(String(level1.accountId));
    expect(String(result[1].accountId)).toBe(String(level2.accountId));
  });

  it("chain rỗng -> trả mảng rỗng, không phải null", async () => {
    const { account } = await createUserInfo(1);
    getApprovalChain.mockResolvedValue([]);

    const result = await getEligibleReviewers(account._id);
    expect(result).toEqual([]);
  });

  it("throw NotFoundException (404) khi tài khoản không có hồ sơ nhân viên", async () => {
    await expect(getEligibleReviewers(new mongoose.Types.ObjectId())).rejects.toMatchObject({
      statusCode: 404,
      message: "Không tìm thấy thông tin nhân viên"
    });
  });
});
