import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import UserInfoModel from "../src/models/UserInfoModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";
import { buildAbility } from "../src/modules/permission";

const allCompanyPayrollAbility = buildAbility([{ action: "payroll.view", subject: "Payroll" }]);

const TZ = "Asia/Ho_Chi_Minh";

let mongod: MongoMemoryServer;

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
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function createUser(accountId: mongoose.Types.ObjectId, maNv: string, seq: number) {
  return UserInfoModel.create({
    full_name: `NV ${maNv}`,
    cccd: `00000000010${seq}`,
    phone_number: `090000010${seq}`,
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: accountId,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
}

// Đơn nghỉ phép thứ 7 lưu WorkDayStatus period "full" (buildWorkDatesWithStatus) nhưng chỉ trừ 0,5
// phép và tính 0,5 công — trước khi fix, cột "Nghỉ phép" đếm theo period nên thứ 7 bị tính 1.
async function seedPaidLeave(userId: mongoose.Types.ObjectId, dateKey: string, workUnit: number) {
  const date = moment.tz(dateKey, TZ).startOf("day").toDate();
  const ws = await WorkSheetModel.create({ user_id: userId, date, work_unit: workUnit });
  await WorkDayStatusModel.create({
    user_id: userId,
    worksheet_id: ws._id,
    date,
    period: "full",
    status: "leave_paid",
    sources: [{ ref_id: new mongoose.Types.ObjectId(), ref_type: "request" }]
  });
}

describe("Payroll stats — nghỉ phép thứ 7 đếm 0,5 ngày", () => {
  test("getPayrollStats: nghỉ phép T7 17/10 + T3 20/10 -> leave_paid_days = 1.5", async () => {
    const accountId = new mongoose.Types.ObjectId();
    const user = await createUser(accountId, "NV101", 1);
    await seedPaidLeave(user._id, "2026-10-17", 0.5);
    await seedPaidLeave(user._id, "2026-10-20", 1);

    const req = {
      params: { userId: user._id.toString() },
      query: { month: "10", year: "2026" },
      account: { _id: accountId, role: "employee" }
    };
    const res = makeRes();
    await AttendanceController.getPayrollStats(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.summary.leave_paid_days).toBe(1.5);
    expect(call.summary.work_unit_total).toBe(1.5);
  });

  test("getPayrollStatsAll: 2 ngày nghỉ phép thứ 7 -> leave_paid_days = 1", async () => {
    const adminAccountId = new mongoose.Types.ObjectId();
    await createUser(adminAccountId, "ADM101", 2);
    const user = await createUser(new mongoose.Types.ObjectId(), "NV102", 3);
    await seedPaidLeave(user._id, "2026-09-26", 0.5);
    await seedPaidLeave(user._id, "2026-10-17", 0.5);

    const req = {
      query: { month: "10", year: "2026" },
      account: { _id: adminAccountId, role: "admin" },
      permissionAbility: allCompanyPayrollAbility
    };
    const res = makeRes();
    await AttendanceController.getPayrollStatsAll(req, res);

    const call = res.json.mock.calls[0][0];
    const target = call.data.find((d: any) => d.ma_nv === "NV102");
    expect(target.leave_paid_days).toBe(1);
    expect(target.work_unit_total).toBe(1);
  });
});
