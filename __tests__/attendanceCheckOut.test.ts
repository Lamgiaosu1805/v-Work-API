import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import AllowedWifiLocationModel from "../src/models/AllowedWifiLocationModel";
import UserInfoModel from "../src/models/UserInfoModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import WorkDayStatusModel from "../src/models/WorkDayStatusModel";
import ShiftModel from "../src/models/ShiftModel";
import LeaveBalanceModel from "../src/models/LeaveBalanceModel";
import redisMock from "./mocks/redis";

const TZ = "Asia/Ho_Chi_Minh";

let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  // Bắt buộc: chờ Mongoose build xong index nền (background) cho mọi model TRƯỚC khi chạy test có
  // transaction thật — đã tự verify (script riêng): nếu bỏ qua bước này, lần đầu 1 model có index
  // được dùng bên trong transaction sẽ đụng độ với background index creation của chính Mongoose, ra
  // lỗi "Unable to write to collection ... due to catalog changes" — không phải bug nghiệp vụ, mà là
  // race condition thuần của môi trường test (mongoose index build không await tự động).
  await Promise.all([
    AllowedWifiLocationModel.init(),
    UserInfoModel.init(),
    WorkSheetModel.init(),
    WorkDayStatusModel.init(),
    ShiftModel.init(),
    LeaveBalanceModel.init()
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset.stop();
});

beforeEach(async () => {
  await AllowedWifiLocationModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await WorkDayStatusModel.deleteMany({});
  await ShiftModel.deleteMany({});
  await LeaveBalanceModel.deleteMany({});
  redisMock.__store.clear();
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

const WIFI = { ssid: "TestWifi", latitude: 21.0, longitude: 105.8, radius: 100 };

async function seedWifi() {
  await AllowedWifiLocationModel.create(WIFI);
}

// Chưa từng có test nào cho AttendanceController.checkOut trước khi cutover (task 1.8.3.6) —
// characterization test mới, tập trung vào phần vừa cutover: applyLeaveConflictOverride +
// adjustLeaveBalance (thay resolveLeaveConflictOnAttendance cũ).
describe("AttendanceController.checkOut", () => {
  test("check-out thành công, không có leave conflict: cập nhật check_out/minute_early, không gọi leave balance", async () => {
    await seedWifi();
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
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const today = moment.tz(TZ).startOf("day").toDate();
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: today,
      shifts: [shift._id],
      check_in: moment.tz(TZ).startOf("day").hour(8).toDate(),
      check_out: null
    });

    const req = {
      body: { ssid: WIFI.ssid, latitude: WIFI.latitude, longitude: WIFI.longitude },
      account: { _id: accountId }
    };
    const res = makeRes();
    await AttendanceController.checkOut(req, res);

    // checkOut không gọi res.status() tường minh cho thành công (mặc định 200 của Express khi chỉ
    // gọi res.json() trực tiếp) — verify qua nội dung message thay vì status code.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Check-out thành công" })
    );
    const ws: any = await WorkSheetModel.findOne({ user_id: userInfo._id }).lean();
    expect(ws.check_out).not.toBeNull();
    const balance = await LeaveBalanceModel.countDocuments({ user_id: userInfo._id });
    expect(balance).toBe(0); // không có leave conflict -> không tạo ledger refund nào
  });

  test("check-out che phủ leave_paid buổi chiều: flip present + tạo ledger hoàn 0.5 phép", async () => {
    await seedWifi();
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
    const shift = await ShiftModel.create({
      name: "Ca hành chính",
      start_time: "08:00",
      end_time: "17:30"
    });
    const today = moment.tz(TZ).startOf("day").toDate();
    const worksheet = await WorkSheetModel.create({
      user_id: userInfo._id,
      date: today,
      shifts: [shift._id],
      check_in: moment.tz(TZ).startOf("day").hour(8).toDate(),
      check_out: null
    });
    // Nhân viên đã xin nghỉ buổi chiều (leave_paid) nhưng vẫn check-out đúng giờ tan ca
    const leaveDoc = await WorkDayStatusModel.create({
      user_id: userInfo._id,
      worksheet_id: worksheet._id,
      date: today,
      period: "afternoon",
      status: "leave_paid",
      sources: []
    });

    const req = {
      body: { ssid: WIFI.ssid, latitude: WIFI.latitude, longitude: WIFI.longitude },
      account: { _id: accountId }
    };
    const res = makeRes();
    // Check-out đúng giờ tan ca (17:30) -> coversAfternoon = true (checkOut >= 17:30 - 60p = 16:30)
    const checkoutMoment = moment.tz(TZ).startOf("day").hour(17).minute(30);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(checkoutMoment.toDate());
    try {
      await AttendanceController.checkOut(req, res);
    } finally {
      jest.useRealTimers();
    }

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Check-out thành công" })
    );

    const updatedLeave = await WorkDayStatusModel.findById(leaveDoc._id);
    expect(updatedLeave?.status).toBe("present");

    const ledger: any = await LeaveBalanceModel.findOne({ user_id: userInfo._id }).lean();
    expect(ledger).not.toBeNull();
    expect(ledger.amount).toBe(0.5);
    expect(ledger.reason).toBe("attendance_override_refund");
  });
});
