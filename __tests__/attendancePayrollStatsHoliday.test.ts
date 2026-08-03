import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import UserInfoModel from "../src/models/UserInfoModel";
import HolidayModel from "../src/models/HolidayModel";
import WorkSheetModel from "../src/models/WorkSheetModel";

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
  await HolidayModel.deleteMany({});
  await WorkSheetModel.deleteMany({});
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

// Gap SRS phát hiện task 1.8.3.4b: "ngày lễ (paid) mặc định hiển thị 1 ngày công" dù nhân viên không
// chấm công ngày đó (hợp lý — ngày lễ không cần đi làm). Trước khi fix, ngày lễ không có worksheet
// hoàn toàn KHÔNG xuất hiện trong `daily` và không cộng vào `work_unit_total`.
describe("AttendanceController — Holiday-awareness cho work_unit (gap SRS, task 1.8.3.4b)", () => {
  test("getPayrollStats (xem của chính mình): ngày lễ paid không có worksheet -> daily có entry work_unit=1", async () => {
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await UserInfoModel.create({
      full_name: "NV Test",
      cccd: "000000000001",
      phone_number: "0900000001",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: accountId,
      ma_nv: "NV001",
      employment_type: "fulltime"
    });
    // Ngày lễ thứ 4 2/9/2026, paid, scope "all" -> nằm trong kỳ công tháng 9/2026 (26/8-25/9)
    await HolidayModel.create({
      date: moment.tz("2026-09-02", TZ).startOf("day").toDate(),
      name: "Quốc khánh",
      year: 2026,
      duration_days: 1,
      scope_type: "all",
      pay_policy: "paid"
    });
    // KHÔNG tạo worksheet nào cho ngày 2/9/2026 — nhân viên không chấm công vì là ngày lễ.

    const req = {
      params: { userId: userInfo._id.toString() },
      query: { month: "9", year: "2026" },
      account: { _id: accountId, role: "employee" }
    };
    const res = makeRes();
    await AttendanceController.getPayrollStats(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.summary.work_unit_total).toBe(1);
    const holidayDay = call.daily.find((d: any) => d.date === "2026-09-02");
    expect(holidayDay).toBeDefined();
    expect(holidayDay.work_unit).toBe(1);
    expect(holidayDay.worksheet_id).toBeNull();
  });

  test("getPayrollStats: ngày lễ nhưng ĐÃ có worksheet thật (vd đi làm bù) -> giữ nguyên work_unit đã tính, không bị ghi đè", async () => {
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await UserInfoModel.create({
      full_name: "NV Test 2",
      cccd: "000000000002",
      phone_number: "0900000002",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: accountId,
      ma_nv: "NV002",
      employment_type: "fulltime"
    });
    await HolidayModel.create({
      date: moment.tz("2026-09-02", TZ).startOf("day").toDate(),
      name: "Quốc khánh",
      year: 2026,
      duration_days: 1,
      scope_type: "all",
      pay_policy: "paid"
    });
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: moment.tz("2026-09-02", TZ).startOf("day").toDate(),
      shifts: [],
      check_in: null,
      check_out: null,
      work_unit: 0 // vd đã bị đánh dấu vắng vì lý do khác, có worksheet nhưng work_unit=0
    });

    const req = {
      params: { userId: userInfo._id.toString() },
      query: { month: "9", year: "2026" },
      account: { _id: accountId, role: "employee" }
    };
    const res = makeRes();
    await AttendanceController.getPayrollStats(req, res);

    const call = res.json.mock.calls[0][0];
    const holidayDay = call.daily.find((d: any) => d.date === "2026-09-02");
    expect(holidayDay.work_unit).toBe(0); // không bị Holiday-default ghi đè vì đã có worksheet
  });

  test("getPayrollStats: ngày lễ pay_policy=unpaid -> không có default", async () => {
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await UserInfoModel.create({
      full_name: "NV Test 3",
      cccd: "000000000003",
      phone_number: "0900000003",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: accountId,
      ma_nv: "NV003",
      employment_type: "fulltime"
    });
    await HolidayModel.create({
      date: moment.tz("2026-09-02", TZ).startOf("day").toDate(),
      name: "Ngày lễ nội bộ không lương",
      year: 2026,
      duration_days: 1,
      scope_type: "all",
      pay_policy: "unpaid"
    });

    const req = {
      params: { userId: userInfo._id.toString() },
      query: { month: "9", year: "2026" },
      account: { _id: accountId, role: "employee" }
    };
    const res = makeRes();
    await AttendanceController.getPayrollStats(req, res);

    const call = res.json.mock.calls[0][0];
    const holidayDay = call.daily.find((d: any) => d.date === "2026-09-02");
    expect(holidayDay).toBeUndefined();
    expect(call.summary.work_unit_total).toBe(0);
  });

  test("getPayrollStatsAll (admin xem toàn bộ): work_unit_total cộng đúng default cho user không có worksheet ngày lễ", async () => {
    const adminAccountId = new mongoose.Types.ObjectId();
    const targetAccountId = new mongoose.Types.ObjectId();
    await UserInfoModel.create({
      full_name: "Admin",
      cccd: "000000000010",
      phone_number: "0900000010",
      sex: 1,
      date_of_birth: new Date("1990-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: adminAccountId,
      ma_nv: "ADM001",
      employment_type: "fulltime"
    });
    await UserInfoModel.create({
      full_name: "NV Test 4",
      cccd: "000000000004",
      phone_number: "0900000004",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: targetAccountId,
      ma_nv: "NV004",
      employment_type: "fulltime"
    });
    await HolidayModel.create({
      date: moment.tz("2026-09-02", TZ).startOf("day").toDate(),
      name: "Quốc khánh",
      year: 2026,
      duration_days: 1,
      scope_type: "all",
      pay_policy: "paid"
    });

    const req = {
      query: { month: "9", year: "2026" },
      account: { _id: adminAccountId, role: "admin" }
    };
    const res = makeRes();
    await AttendanceController.getPayrollStatsAll(req, res);

    const call = res.json.mock.calls[0][0];
    const target = call.data.find((d: any) => d.ma_nv === "NV004");
    expect(target.work_unit_total).toBe(1);
  });
});
