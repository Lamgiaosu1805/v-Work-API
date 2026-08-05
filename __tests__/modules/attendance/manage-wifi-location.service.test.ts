import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AllowedWifiLocationModel from "../../../src/models/AllowedWifiLocationModel";
import {
  listAllowedWifiLocations,
  createAllowedWifiLocation,
  deleteAllowedWifiLocation
} from "../../../src/modules/attendance/application/manage-wifi-location.service";
import {
  ArgumentInvalidException,
  NotFoundException
} from "../../../src/core/exceptions/exceptions";

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

describe("listAllowedWifiLocations", () => {
  test("trả về danh sách active, không có isDeleted:true", async () => {
    await AllowedWifiLocationModel.create({
      name: "A",
      ssid: "SSID-A",
      latitude: 21,
      longitude: 105
    });
    await AllowedWifiLocationModel.create({
      name: "B",
      ssid: "SSID-B",
      latitude: 21,
      longitude: 105,
      isDeleted: true
    });

    const result = await listAllowedWifiLocations();
    expect(result).toHaveLength(1);
    expect(result[0].ssid).toBe("SSID-A");
  });
});

describe("createAllowedWifiLocation", () => {
  test("thiếu ssid/latitude/longitude: throw 400", async () => {
    await expect(
      createAllowedWifiLocation({ ssid: undefined, latitude: 21, longitude: 105 })
    ).rejects.toThrow("ssid, latitude, longitude là bắt buộc");
  });

  test("SSID đã tồn tại: throw 400", async () => {
    await AllowedWifiLocationModel.create({ ssid: "SSID-A", latitude: 21, longitude: 105 });

    const err = await createAllowedWifiLocation({
      ssid: "SSID-A",
      latitude: 21,
      longitude: 105
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ArgumentInvalidException);
    expect(err.message).toBe('SSID "SSID-A" đã tồn tại');
  });

  test("thành công: dùng default radius=100 (schema) khi không truyền", async () => {
    const doc = await createAllowedWifiLocation({ ssid: "SSID-A", latitude: 21, longitude: 105 });
    expect(doc.ssid).toBe("SSID-A");
    expect(doc.radius).toBe(100);
  });

  test("thành công: dùng radius truyền vào", async () => {
    const doc = await createAllowedWifiLocation({
      ssid: "SSID-A",
      latitude: 21,
      longitude: 105,
      radius: 50
    });
    expect(doc.radius).toBe(50);
  });
});

describe("deleteAllowedWifiLocation", () => {
  test("không tồn tại: throw 404", async () => {
    await expect(
      deleteAllowedWifiLocation(new mongoose.Types.ObjectId().toString())
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test("thành công: soft delete, không còn trong listAllowedWifiLocations", async () => {
    const doc = await AllowedWifiLocationModel.create({
      ssid: "SSID-A",
      latitude: 21,
      longitude: 105
    });

    await deleteAllowedWifiLocation(doc._id.toString());

    const updated: any = await AllowedWifiLocationModel.findById(doc._id).lean();
    expect(updated?.isDeleted).toBe(true);
    const list = await listAllowedWifiLocations();
    expect(list).toHaveLength(0);
  });
});
