import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import AllowedWifiLocationModel from "../../src/models/AllowedWifiLocationModel";
import UserInfoModel from "../../src/models/UserInfoModel";
import WorkSheetModel from "../../src/models/WorkSheetModel";
import WorkDayStatusModel from "../../src/models/WorkDayStatusModel";
import ShiftModel from "../../src/models/ShiftModel";
import LeaveBalanceModel from "../../src/models/LeaveBalanceModel";
import { recordCheckOut } from "../../src/workflows/record-check-out.workflow";
import { ArgumentInvalidException } from "../../src/core/exceptions/exceptions";

const TZ = "Asia/Ho_Chi_Minh";
const WIFI = { ssid: "TestWifi", latitude: 21.0, longitude: 105.8, radius: 100 };

let replset: MongoMemoryReplSet;

beforeAll(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());
  // Bắt buộc: chờ Mongoose build xong index nền cho mọi model TRƯỚC khi chạy test có transaction thật
  // (xem giải thích đầy đủ ở attendanceCheckOut.test.ts / plan doc task 1.8.3.6).
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
});

async function seedWifi() {
  await AllowedWifiLocationModel.create(WIFI);
}

async function seedUserInfo(accountId: mongoose.Types.ObjectId, maNv: string) {
  return UserInfoModel.create({
    full_name: "NV Test",
    cccd: `00000000000${maNv}`,
    phone_number: `090000000${maNv}`,
    sex: 1,
    date_of_birth: new Date("1995-01-01"),
    address: "HN",
    tinh_trang_hon_nhan: 0,
    id_account: accountId,
    ma_nv: maNv,
    employment_type: "fulltime"
  });
}

describe("recordCheckOut — validate lỗi (7 nhánh 400)", () => {
  test("thiếu ssid/latitude/longitude", async () => {
    await expect(
      recordCheckOut({ account: { _id: "acc1" }, ssid: undefined, latitude: 21, longitude: 105 })
    ).rejects.toThrow("ssid, latitude, longitude required");
  });

  test("SSID không tồn tại", async () => {
    await expect(
      recordCheckOut({
        account: { _id: "acc1" },
        ssid: "khong-ton-tai",
        latitude: 21,
        longitude: 105
      })
    ).rejects.toThrow("SSID không hợp lệ.");
  });

  test("vị trí ngoài bán kính cho phép", async () => {
    await seedWifi();
    const err = await recordCheckOut({
      account: { _id: "acc1" },
      ssid: WIFI.ssid,
      latitude: 22.0,
      longitude: 105.8
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArgumentInvalidException);
    expect(err.message).toBe("Vị trí không hợp lệ.");
  });

  test("account không có UserInfo", async () => {
    await seedWifi();
    await expect(
      recordCheckOut({
        account: { _id: new mongoose.Types.ObjectId().toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("User info không tồn tại");
  });

  test("chưa có worksheet hôm nay", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    await seedUserInfo(accountId, "001");

    await expect(
      recordCheckOut({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("Bạn chưa có ca làm việc hôm nay, không thể check-out.");
  });

  test("đã check-out rồi", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "002");
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
      check_out: moment.tz(TZ).startOf("day").hour(17).minute(30).toDate()
    });

    await expect(
      recordCheckOut({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("Bạn đã check-out hôm nay rồi.");
  });

  test("worksheet không có ca nào", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "003");
    const today = moment.tz(TZ).startOf("day").toDate();
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: today,
      shifts: [],
      check_in: moment.tz(TZ).startOf("day").hour(8).toDate(),
      check_out: null
    });

    await expect(
      recordCheckOut({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("Không có ca làm việc hợp lệ.");
  });
});

describe("recordCheckOut — happy path", () => {
  test("check-out đúng giờ, không có leave conflict/pending status: ghi check_out/minute_early=0, không tạo ledger", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "004");
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

    const checkOutMoment = moment.tz(TZ).startOf("day").hour(17).minute(30);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(checkOutMoment.toDate());
    let result;
    try {
      result = await recordCheckOut({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      });
    } finally {
      jest.useRealTimers();
    }

    expect(result.minuteEarly).toBe(0);
    expect(result.checkOut).toEqual(checkOutMoment.toDate());

    const ws: any = await WorkSheetModel.findOne({ user_id: userInfo._id }).lean();
    expect(ws.check_out).toEqual(checkOutMoment.toDate());
    expect(ws.minute_early).toBe(0);

    const ledgerCount = await LeaveBalanceModel.countDocuments({ user_id: userInfo._id });
    expect(ledgerCount).toBe(0);
  });

  test("check-out sớm 20 phút: ghi đúng minute_early=20", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "005");
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

    const checkOutMoment = moment.tz(TZ).startOf("day").hour(17).minute(10);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(checkOutMoment.toDate());
    let result;
    try {
      result = await recordCheckOut({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      });
    } finally {
      jest.useRealTimers();
    }

    expect(result.minuteEarly).toBe(20);
    const ws: any = await WorkSheetModel.findOne({ user_id: userInfo._id }).lean();
    expect(ws.minute_early).toBe(20);
  });

  test("check-out che phủ leave_paid buổi chiều: flip present + tạo ledger hoàn 0.5 phép", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "006");
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
    const leaveDoc = await WorkDayStatusModel.create({
      user_id: userInfo._id,
      worksheet_id: worksheet._id,
      date: today,
      period: "afternoon",
      status: "leave_paid",
      sources: []
    });

    const checkOutMoment = moment.tz(TZ).startOf("day").hour(17).minute(30);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(checkOutMoment.toDate());
    try {
      await recordCheckOut({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      });
    } finally {
      jest.useRealTimers();
    }

    const updatedLeave = await WorkDayStatusModel.findById(leaveDoc._id);
    expect(updatedLeave?.status).toBe("present");

    const ledger: any = await LeaveBalanceModel.findOne({ user_id: userInfo._id }).lean();
    expect(ledger).not.toBeNull();
    expect(ledger.amount).toBe(0.5);
    expect(ledger.reason).toBe("attendance_override_refund");
  });

  // Task 1.8.4.8 — bước mới phát hiện ngoài danh sách ban đầu (markAttendancePresent).
  test("check-out flip status 'pending' (attendance-driven, không liên quan leave) của worksheet thành 'present'", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "007");
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
    const pendingDoc = await WorkDayStatusModel.create({
      user_id: userInfo._id,
      worksheet_id: worksheet._id,
      date: today,
      period: "full",
      status: "pending",
      sources: []
    });

    await recordCheckOut({
      account: { _id: accountId.toString() },
      ssid: WIFI.ssid,
      latitude: WIFI.latitude,
      longitude: WIFI.longitude
    });

    const updated = await WorkDayStatusModel.findById(pendingDoc._id);
    expect(updated?.status).toBe("present");
  });
});
