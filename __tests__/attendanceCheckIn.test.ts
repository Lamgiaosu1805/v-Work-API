import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import AttendanceController from "../src/controllers/AttendanceController";
import AllowedWifiLocationModel from "../src/models/AllowedWifiLocationModel";
import UserInfoModel from "../src/models/UserInfoModel";
import WorkSheetModel from "../src/models/WorkSheetModel";
import ShiftModel from "../src/models/ShiftModel";

const TZ = "Asia/Ho_Chi_Minh";
const WIFI = { ssid: "TestWifi", latitude: 21.0, longitude: 105.8, radius: 100 };

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
  await AllowedWifiLocationModel.deleteMany({});
  await UserInfoModel.deleteMany({});
  await WorkSheetModel.deleteMany({});
  await ShiftModel.deleteMany({});
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function seedWifi() {
  await AllowedWifiLocationModel.create(WIFI);
}

// Characterization test cho cutover task 1.8.4.11 (AttendanceController.checkIn giờ gọi qua
// modules/attendance.recordCheckIn thay vì logic inline) — logic nghiệp vụ đã được test đầy đủ ở
// record-check-in.service.test.ts (1.8.4.7); ở đây chỉ verify phần WIRING qua Express thật: req/res
// thật, sendExceptionResponse map đúng status/message như hành vi gốc.
describe("AttendanceController.checkIn (cutover 1.8.4.11)", () => {
  test("check-in thành công: trả đúng message/check_in/minutes_late, ghi đúng WorkSheetModel", async () => {
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
      check_in: null,
      check_out: null
    });

    const req = {
      body: { ssid: WIFI.ssid, latitude: WIFI.latitude, longitude: WIFI.longitude },
      account: { _id: accountId }
    };
    const res = makeRes();

    const checkInMoment = moment.tz(TZ).startOf("day").hour(8).minute(0);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(checkInMoment.toDate());
    try {
      await AttendanceController.checkIn(req, res);
    } finally {
      jest.useRealTimers();
    }

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Check-in thành công", minutes_late: 0 })
    );
    const ws: any = await WorkSheetModel.findOne({ user_id: userInfo._id }).lean();
    expect(ws.check_in).toEqual(checkInMoment.toDate());
  });

  test("lỗi validate (SSID không hợp lệ): trả đúng 400 + message, đi qua sendExceptionResponse", async () => {
    const req = {
      body: { ssid: "khong-ton-tai", latitude: 21, longitude: 105 },
      account: { _id: new mongoose.Types.ObjectId() }
    };
    const res = makeRes();

    await AttendanceController.checkIn(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "SSID không hợp lệ." });
  });
});
