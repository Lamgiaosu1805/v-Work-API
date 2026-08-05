import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AllowedWifiLocationModel from "../../../src/models/AllowedWifiLocationModel";
import { checkWifiLocation } from "../../../src/modules/attendance/application/check-wifi-location.service";
import { ArgumentInvalidException } from "../../../src/core/exceptions/exceptions";

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
});

describe("checkWifiLocation", () => {
  test("thiếu ssid/latitude/longitude: throw 400", async () => {
    await expect(
      checkWifiLocation({ ssid: undefined, latitude: 21, longitude: 105 })
    ).rejects.toThrow("ssid, latitude, longitude required");
  });

  test("SSID không tồn tại/đã xóa: throw 400", async () => {
    await expect(
      checkWifiLocation({ ssid: "khong-ton-tai", latitude: 21, longitude: 105 })
    ).rejects.toThrow("SSID không hợp lệ.");
  });

  test("vị trí ngoài bán kính cho phép: throw 400", async () => {
    await AllowedWifiLocationModel.create(WIFI);
    const err = await checkWifiLocation({
      ssid: WIFI.ssid,
      latitude: 22.0,
      longitude: 105.8
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArgumentInvalidException);
    expect(err.message).toBe("Vị trí không hợp lệ.");
  });

  test("hợp lệ: resolve không throw", async () => {
    await AllowedWifiLocationModel.create(WIFI);
    await expect(
      checkWifiLocation({ ssid: WIFI.ssid, latitude: WIFI.latitude, longitude: WIFI.longitude })
    ).resolves.toBeUndefined();
  });
});
