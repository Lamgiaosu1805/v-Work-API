import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import UserInfoModel from "../src/models/UserInfoModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";
import EmploymentStatusModel from "../src/models/EmploymentStatusModel";
import { buildAbility } from "../src/modules/permission";

const allCompanyPayrollAbility = buildAbility([{ action: "payroll.view", subject: "Payroll" }]);

const TZ = "Asia/Ho_Chi_Minh";
const day = (value: string) => moment.tz(value, TZ).startOf("day").toDate();

let mongod: MongoMemoryServer;
let probationId: mongoose.Types.ObjectId;
let officialId: mongoose.Types.ObjectId;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await UserInfoModel.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await WorkDayStatusModel.deleteMany({});
  await EmploymentStatusModel.deleteMany({});
  const [probation, official] = await EmploymentStatusModel.create([
    { code: "probation", name: "Thử việc" },
    { code: "official", name: "Chính thức" }
  ]);
  probationId = probation._id;
  officialId = official._id;
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function createUser(
  accountId: mongoose.Types.ObjectId,
  maNv: string,
  seq: number,
  extra: Record<string, unknown> = {}
) {
  return UserInfoModel.create({
    full_name: `NV ${maNv}`,
    cccd: `00000000020${seq}`,
    phone_number: `090000020${seq}`,
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: accountId,
    ma_nv: maNv,
    employment_type: "fulltime",
    start_date: day("2026-10-01"),
    ...extra
  });
}

// Kỳ T10/2026: 26/09 → 25/10; 3 ngày đi làm 05/10, 06/10, 20/10
async function seedWorkDays(userId: mongoose.Types.ObjectId) {
  for (const dateKey of ["2026-10-05", "2026-10-06", "2026-10-20"]) {
    // eslint-disable-next-line no-await-in-loop
    const ws = await WorkSheetModel.create({ user_id: userId, date: day(dateKey), work_unit: 1 });
    // eslint-disable-next-line no-await-in-loop
    await WorkDayStatusModel.create({
      user_id: userId,
      worksheet_id: ws._id,
      date: day(dateKey),
      period: "full",
      status: "present",
      sources: []
    });
  }
}

async function statsOf(userId: mongoose.Types.ObjectId, accountId: mongoose.Types.ObjectId) {
  const res = makeRes();
  await AttendanceController.getPayrollStats(
    {
      params: { userId: userId.toString() },
      query: { month: "10", year: "2026" },
      account: { _id: accountId, role: "employee" }
    },
    res
  );
  return res.json.mock.calls[0][0].summary;
}

describe("Chia công thử việc / chính thức", () => {
  test.each([
    ["Thử việc chưa có ngày hết thử việc → toàn bộ là công thử việc", "probation", null, [3, 0]],
    ["Chính thức, không có ngày hết thử việc → vào làm chính thức luôn", "official", null, [0, 3]],
    ["Chưa chọn loại hợp đồng, không có ngày hết thử việc → chính thức", null, null, [0, 3]],
    [
      "Có ngày hết thử việc 06/10 → chia theo ngày (06/10 vẫn là thử việc)",
      "probation",
      "2026-10-06",
      [2, 1]
    ]
  ])("getPayrollStats: %s", async (_label, statusCode, probationEnd, [probation, official]) => {
    const accountId = new mongoose.Types.ObjectId();
    const statusIds: Record<string, mongoose.Types.ObjectId> = {
      probation: probationId,
      official: officialId
    };
    const user = await createUser(accountId, "NV201", 1, {
      employment_status: statusCode ? statusIds[statusCode as string] : null,
      probation_end_date: probationEnd ? day(probationEnd as string) : null
    });
    await seedWorkDays(user._id);

    const summary = await statsOf(user._id, accountId);
    expect(summary.work_unit_total).toBe(3);
    expect(summary.work_unit_probation).toBe(probation);
    expect(summary.work_unit_official).toBe(official);
  });

  test("getPayrollStatsAll: Thử việc chưa có ngày hết thử việc → toàn bộ là công thử việc", async () => {
    const adminAccountId = new mongoose.Types.ObjectId();
    await createUser(adminAccountId, "ADM201", 2);
    const user = await createUser(new mongoose.Types.ObjectId(), "NV202", 3, {
      employment_status: probationId
    });
    await seedWorkDays(user._id);

    const res = makeRes();
    await AttendanceController.getPayrollStatsAll(
      {
        query: { month: "10", year: "2026" },
        account: { _id: adminAccountId, role: "admin" },
        permissionAbility: allCompanyPayrollAbility
      },
      res
    );

    const target = res.json.mock.calls[0][0].data.find((d: any) => d.ma_nv === "NV202");
    expect(target.work_unit_probation).toBe(3);
    expect(target.work_unit_official).toBe(0);
  });
});
