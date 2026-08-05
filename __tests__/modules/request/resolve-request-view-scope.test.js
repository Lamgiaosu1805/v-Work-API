const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

jest.mock("../../../src/helpers/rbac", () => ({ can: jest.fn() }));
jest.mock("../../../src/helpers/approvalChain", () => ({ getManagedUserIds: jest.fn() }));

const { can } = require("../../../src/helpers/rbac");
const { getManagedUserIds } = require("../../../src/helpers/approvalChain");
const UserInfoModel = require("../../../src/models/UserInfoModel");
const AccountModel = require("../../../src/models/AccountModel");
const {
  resolveRequestViewScope
} = require("../../../src/modules/request/application/resolve-request-view-scope");

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
  jest.clearAllMocks();
});

async function createAccountWithUserInfo(n) {
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

describe("resolveRequestViewScope()", () => {
  it("hasViewAll=true — trả về type 'all' kèm myUserInfo (dùng để loại trừ đơn của chính mình)", async () => {
    const { account, userInfo } = await createAccountWithUserInfo(1);
    can.mockResolvedValue(true);

    const scope = await resolveRequestViewScope(account);

    expect(scope.type).toBe("all");
    expect(String(scope.myUserInfo._id)).toBe(String(userInfo._id));
    expect(getManagedUserIds).not.toHaveBeenCalled();
  });

  it("hasViewAll=true nhưng không có myUserInfo — vẫn trả về type 'all', myUserInfo null, KHÔNG throw", async () => {
    const account = await AccountModel.create({
      username: "acc-no-info",
      password: "x",
      role: "user"
    });
    can.mockResolvedValue(true);

    const scope = await resolveRequestViewScope(account);

    expect(scope.type).toBe("all");
    expect(scope.myUserInfo).toBeNull();
  });

  it("hasViewAll=false, hasReview=false — throw ForbiddenException (403)", async () => {
    const { account } = await createAccountWithUserInfo(1);
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await expect(resolveRequestViewScope(account)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("hasViewAll=false, hasReview=true, không có myUserInfo — throw NotFoundException (404), message nhất quán với 1.6/1.7", async () => {
    const account = await AccountModel.create({
      username: "acc-no-info-2",
      password: "x",
      role: "user"
    });
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(resolveRequestViewScope(account)).rejects.toMatchObject({
      statusCode: 404,
      message: "Không tìm thấy thông tin nhân viên"
    });
  });

  it("hasViewAll=false, hasReview=true, có myUserInfo — trả về type 'managed' với userIds từ getManagedUserIds", async () => {
    const { account, userInfo } = await createAccountWithUserInfo(1);
    can.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const managedIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    getManagedUserIds.mockResolvedValue(managedIds);

    const scope = await resolveRequestViewScope(account);

    expect(scope.type).toBe("managed");
    expect(scope.userIds).toBe(managedIds);
    expect(String(scope.myUserInfo._id)).toBe(String(userInfo._id));
    expect(getManagedUserIds).toHaveBeenCalledWith(userInfo._id);
  });
});
