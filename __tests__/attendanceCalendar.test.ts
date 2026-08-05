import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import UserInfoModel from "../src/models/UserInfoModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";

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

// Yêu cầu nghiệp vụ mới: 1 ngày có thể trả ra nhiều trạng thái cùng lúc (vd quên chấm công buổi sáng
// + đi làm bình thường nhưng về sớm buổi chiều). Trước khi sửa, getCalendar() chỉ lọc
// status in [leave_paid, leave_unpaid, absent] (bỏ sót missed_clock/present/remote/...) và hoàn toàn
// không trả minutes_late/minute_early — FE không đủ dữ liệu để ghép badge.
describe("AttendanceController.getCalendar — đủ dữ liệu để FE ghép nhiều badge/ngày", () => {
  test("trả về day_statuses không lọc theo status (bao gồm missed_clock) + late_early theo ngày", async () => {
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await UserInfoModel.create({
      full_name: "NV Calendar",
      cccd: "000000000099",
      phone_number: "0900000099",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: accountId,
      ma_nv: "NVCAL01",
      employment_type: "fulltime"
    });

    const dayDate = moment.tz("2026-09-10", TZ).startOf("day").toDate();

    const worksheet = await WorkSheetModel.create({
      user_id: userInfo._id,
      date: dayDate,
      shifts: [],
      check_in: null,
      check_out: moment.tz("2026-09-10 16:00", TZ).toDate(),
      minutes_late: 0,
      minute_early: 30,
      work_unit: 1
    });

    // Buổi sáng: quên chấm công (missed_clock) — trước đây bị lọc bỏ hoàn toàn khỏi response.
    await WorkDayStatusModel.create({
      user_id: userInfo._id,
      worksheet_id: worksheet._id,
      date: dayDate,
      period: "morning",
      status: "missed_clock",
      sources: []
    });
    // Buổi chiều: có mặt (present) nhưng về sớm 30 phút — minutes_late/minute_early nằm trên WorkSheet.
    await WorkDayStatusModel.create({
      user_id: userInfo._id,
      worksheet_id: worksheet._id,
      date: dayDate,
      period: "afternoon",
      status: "present",
      sources: []
    });

    const req = {
      query: { month: "9", year: "2026" },
      account: { _id: accountId }
    };
    const res = makeRes();
    await AttendanceController.getCalendar(req as any, res as any);

    const call = res.json.mock.calls[0][0];
    const statuses = call.data.day_statuses.filter((d: any) => d.date === "2026-09-10");
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s: any) => s.status).sort()).toEqual(["missed_clock", "present"]);

    const lateEarly = call.data.late_early.find((d: any) => d.date === "2026-09-10");
    expect(lateEarly).toBeDefined();
    expect(lateEarly.minute_early).toBe(30);
    expect(lateEarly.minutes_late).toBe(0);
  });

  test("ngày không đi muộn/về sớm: không xuất hiện trong late_early", async () => {
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await UserInfoModel.create({
      full_name: "NV Calendar 2",
      cccd: "000000000098",
      phone_number: "0900000098",
      sex: 1,
      date_of_birth: new Date("1995-01-01"),
      address: "HN",
      tinh_trang_hon_nhan: 0,
      id_account: accountId,
      ma_nv: "NVCAL02",
      employment_type: "fulltime"
    });

    const dayDate = moment.tz("2026-09-11", TZ).startOf("day").toDate();
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: dayDate,
      shifts: [],
      minutes_late: 0,
      minute_early: 0,
      work_unit: 1
    });

    const req = {
      query: { month: "9", year: "2026" },
      account: { _id: accountId }
    };
    const res = makeRes();
    await AttendanceController.getCalendar(req as any, res as any);

    const call = res.json.mock.calls[0][0];
    expect(call.data.late_early.find((d: any) => d.date === "2026-09-11")).toBeUndefined();
  });
});
