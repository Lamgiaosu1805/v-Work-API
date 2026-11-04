import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { accrueMonthlyLeave } = require("../src/jobs/accrueMonthlyLeave");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UserInfoModel = require("../src/models/UserInfoModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const EmploymentStatusModel = require("../src/models/EmploymentStatusModel");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LeaveBalanceModel = require("../src/models/LeaveBalanceModel");

let mongod: MongoMemoryServer;
let seq = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  seq = 0;
  await Promise.all([
    UserInfoModel.deleteMany({}),
    EmploymentStatusModel.deleteMany({}),
    LeaveBalanceModel.deleteMany({})
  ]);
});

const makeUser = (statusId: unknown, resignationDate: Date | null = null) => {
  seq += 1;
  return UserInfoModel.create({
    full_name: `NV ${seq}`,
    cccd: `cccd-${seq}`,
    phone_number: "0900000000",
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: new mongoose.Types.ObjectId(),
    ma_nv: `NV${seq}`,
    employment_type: "fulltime",
    employment_status: statusId,
    resignation_date: resignationDate
  });
};

describe("accrueMonthlyLeave", () => {
  test("không cộng phép cho nhân viên đã nghỉ việc, vẫn cộng cho người đang làm và người sắp nghỉ", async () => {
    const status = await EmploymentStatusModel.create({
      name: "Chính thức",
      code: "OFFICIAL",
      accrues_annual_leave: true
    });
    const working = await makeUser(status._id);
    const leavingSoon = await makeUser(status._id, new Date(Date.now() + 7 * 24 * 3600 * 1000));
    const gone = await makeUser(status._id, new Date(Date.now() - 24 * 3600 * 1000));

    await accrueMonthlyLeave();

    const accruedIds = (await LeaveBalanceModel.distinct("user_id")).map(String).sort();
    expect(accruedIds).toEqual([String(working._id), String(leavingSoon._id)].sort());
    expect(accruedIds).not.toContain(String(gone._id));
  });
});
