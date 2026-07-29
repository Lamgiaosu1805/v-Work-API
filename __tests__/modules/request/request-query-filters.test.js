const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const {
  applyRequestTypeFilter,
  applyDateRangeFilter,
  buildUserNameSearchFilter,
  VALID_TYPES
} = require("../../../src/modules/request/application/request-query-filters");
const UserInfoModel = require("../../../src/models/UserInfoModel");
const AccountModel = require("../../../src/models/AccountModel");

describe("applyRequestTypeFilter()", () => {
  it("không làm gì nếu requestType rỗng/undefined", () => {
    const filter = {};
    applyRequestTypeFilter(filter, undefined);
    expect(filter).toEqual({});
  });

  it("gán filter.request_type khi requestType hợp lệ", () => {
    const filter = {};
    applyRequestTypeFilter(filter, "leave");
    expect(filter).toEqual({ request_type: "leave" });
  });

  it("throw ArgumentInvalidException (400) khi requestType không hợp lệ — không im lặng bỏ qua", () => {
    const filter = {};
    expect(() => applyRequestTypeFilter(filter, "not_a_real_type")).toThrow();
    try {
      applyRequestTypeFilter(filter, "not_a_real_type");
    } catch (error) {
      expect(error.statusCode).toBe(400);
    }
    expect(filter).toEqual({});
  });

  it("VALID_TYPES khớp đúng 7 discriminator của Request", () => {
    expect(VALID_TYPES.sort()).toEqual(
      [
        "leave",
        "late_early",
        "remote",
        "business_trip",
        "client_visit",
        "explanation",
        "forgot_checkin"
      ].sort()
    );
  });
});

describe("applyDateRangeFilter()", () => {
  it("không làm gì nếu cả from lẫn to đều rỗng", () => {
    const filter = {};
    applyDateRangeFilter(filter, undefined, undefined);
    expect(filter).toEqual({});
  });

  it("gán $gte/$lte đúng khi from/to hợp lệ", () => {
    const filter = {};
    applyDateRangeFilter(filter, "2026-01-05", "2026-01-10");
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.createdAt.$lte).toBeInstanceOf(Date);
    expect(Number.isNaN(filter.createdAt.$gte.getTime())).toBe(false);
    expect(Number.isNaN(filter.createdAt.$lte.getTime())).toBe(false);
  });

  it("throw ArgumentInvalidException (400) khi from không parse được — KHÔNG còn tạo ra Invalid Date đi thẳng vào Mongo (khác hành vi gốc, xem plan)", () => {
    const filter = {};
    expect(() => applyDateRangeFilter(filter, "invalid-date", undefined)).toThrow();
    try {
      applyDateRangeFilter(filter, "invalid-date", undefined);
    } catch (error) {
      expect(error.statusCode).toBe(400);
    }
  });

  it("throw ArgumentInvalidException (400) khi to không parse được", () => {
    const filter = {};
    expect(() => applyDateRangeFilter(filter, undefined, "not-a-date")).toThrow();
  });
});

describe("buildUserNameSearchFilter()", () => {
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
  });

  async function createUserInfo(n, fullName) {
    const account = await AccountModel.create({ username: `acc${n}`, password: "x", role: "user" });
    return UserInfoModel.create({
      full_name: fullName,
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
  }

  it("escape ký tự regex đặc biệt — search chứa dấu ngoặc KHÔNG còn crash MongoServerError (bug thật, xem plan)", async () => {
    await createUserInfo(1, "Nguyen Van A (CN2)");
    await createUserInfo(2, "Tran Thi B");

    await expect(
      UserInfoModel.find(buildUserNameSearchFilter("(CN2)")).select("_id")
    ).resolves.toHaveLength(1);

    const parenOnly = await UserInfoModel.find(buildUserNameSearchFilter("(")).select("_id");
    expect(parenOnly).toHaveLength(1);

    const star = await UserInfoModel.find(buildUserNameSearchFilter("*")).select("_id");
    expect(star).toHaveLength(0);
  });

  it("tìm không phân biệt hoa thường, khớp cả full_name lẫn ma_nv", async () => {
    await createUserInfo(1, "Nguyen Van A");

    const byName = await UserInfoModel.find(buildUserNameSearchFilter("nguyen van a")).select(
      "_id"
    );
    expect(byName).toHaveLength(1);

    const byMaNv = await UserInfoModel.find(buildUserNameSearchFilter("nv1")).select("_id");
    expect(byMaNv).toHaveLength(1);
  });
});
