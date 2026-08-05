import mongoose from "mongoose";
import moment from "moment-timezone";
import { MongoMemoryServer } from "mongodb-memory-server";
import AllowedWifiLocationModel from "../../src/models/AllowedWifiLocationModel";
import UserInfoModel from "../../src/models/UserInfoModel";
import WorkSheetModel from "../../src/models/WorkSheetModel";
import ShiftModel from "../../src/models/ShiftModel";
import { recordCheckIn } from "../../src/workflows/record-check-in.workflow";
import { ArgumentInvalidException } from "../../src/core/exceptions/exceptions";

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

describe("recordCheckIn", () => {
  test("thiếu ssid/latitude/longitude: throw 400 'ssid, latitude, longitude required'", async () => {
    await expect(
      recordCheckIn({ account: { _id: "acc1" }, ssid: undefined, latitude: 21, longitude: 105 })
    ).rejects.toThrow("ssid, latitude, longitude required");
  });

  test("SSID không tồn tại/đã xóa: throw 400 'SSID không hợp lệ.'", async () => {
    await expect(
      recordCheckIn({
        account: { _id: "acc1" },
        ssid: "khong-ton-tai",
        latitude: 21,
        longitude: 105
      })
    ).rejects.toThrow("SSID không hợp lệ.");
  });

  test("vị trí ngoài bán kính cho phép: throw 400 'Vị trí không hợp lệ.'", async () => {
    await seedWifi();
    const err = await recordCheckIn({
      account: { _id: "acc1" },
      ssid: WIFI.ssid,
      latitude: 22.0, // cách xa WIFI.latitude=21.0, chắc chắn ngoài radius=100m
      longitude: 105.8
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArgumentInvalidException);
    expect(err.message).toBe("Vị trí không hợp lệ.");
  });

  test("account không có UserInfo: throw 400 'User info không tồn tại'", async () => {
    await seedWifi();
    await expect(
      recordCheckIn({
        account: { _id: new mongoose.Types.ObjectId().toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("User info không tồn tại");
  });

  test("chưa có worksheet hôm nay: throw 400 'Bạn chưa có ca làm việc hôm nay.'", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    await seedUserInfo(accountId, "001");

    await expect(
      recordCheckIn({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("Bạn chưa có ca làm việc hôm nay.");
  });

  test("đã check-in rồi: throw 400 'Bạn đã check-in hôm nay rồi.'", async () => {
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
      check_out: null
    });

    await expect(
      recordCheckIn({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("Bạn đã check-in hôm nay rồi.");
  });

  test("worksheet không có ca nào: throw 400 'Không có ca làm việc hợp lệ.'", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "003");
    const today = moment.tz(TZ).startOf("day").toDate();
    await WorkSheetModel.create({
      user_id: userInfo._id,
      date: today,
      shifts: [],
      check_in: null,
      check_out: null
    });

    await expect(
      recordCheckIn({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      })
    ).rejects.toThrow("Không có ca làm việc hợp lệ.");
  });

  test("đã quá giờ làm việc (now sau giờ tan ca): throw 400 'Đã quá giờ làm việc, không thể check-in.'", async () => {
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
      check_in: null,
      check_out: null
    });

    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(moment.tz(TZ).startOf("day").hour(18).toDate());
    try {
      await expect(
        recordCheckIn({
          account: { _id: accountId.toString() },
          ssid: WIFI.ssid,
          latitude: WIFI.latitude,
          longitude: WIFI.longitude
        })
      ).rejects.toThrow("Đã quá giờ làm việc, không thể check-in.");
    } finally {
      jest.useRealTimers();
    }
  });

  test("check-in đúng giờ: ghi check_in/minutes_late=0, trả về đúng kết quả", async () => {
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
      check_in: null,
      check_out: null
    });

    const checkInMoment = moment.tz(TZ).startOf("day").hour(8).minute(0);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(checkInMoment.toDate());
    let result;
    try {
      result = await recordCheckIn({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      });
    } finally {
      jest.useRealTimers();
    }

    expect(result.minutesLate).toBe(0);
    expect(result.checkIn).toEqual(checkInMoment.toDate());

    const ws: any = await WorkSheetModel.findOne({ user_id: userInfo._id }).lean();
    expect(ws.check_in).toEqual(checkInMoment.toDate());
    expect(ws.minutes_late).toBe(0);
  });

  test("check-in muộn 20 phút: ghi đúng minutes_late=20", async () => {
    await seedWifi();
    const accountId = new mongoose.Types.ObjectId();
    const userInfo = await seedUserInfo(accountId, "006");
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

    const checkInMoment = moment.tz(TZ).startOf("day").hour(8).minute(20);
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(checkInMoment.toDate());
    let result;
    try {
      result = await recordCheckIn({
        account: { _id: accountId.toString() },
        ssid: WIFI.ssid,
        latitude: WIFI.latitude,
        longitude: WIFI.longitude
      });
    } finally {
      jest.useRealTimers();
    }

    expect(result.minutesLate).toBe(20);
    const ws: any = await WorkSheetModel.findOne({ user_id: userInfo._id }).lean();
    expect(ws.minutes_late).toBe(20);
  });
});
